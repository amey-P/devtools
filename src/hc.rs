//! Thin wrappers around the `hc` and `herdr-app` CLIs (no shell).
//! `HC_BIN` / `HERDR_APP_BIN` override the binaries.

use std::process::{Output, Stdio};
use std::time::Duration;

use serde_json::Value;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::format::{HcError, parse_hc_error};

#[derive(Debug, Clone)]
pub struct HcOk {
    pub data: Value,
    pub text: String,
}

pub type HcResult = Result<HcOk, HcError>;

#[derive(Debug, Clone)]
pub struct HcOpts {
    pub timeout: Duration,
    /// add --json and parse stdout (default true)
    pub json: bool,
    pub cancel: CancellationToken,
}

impl HcOpts {
    pub fn new(cancel: &CancellationToken) -> Self {
        Self { timeout: Duration::from_secs(30), json: true, cancel: cancel.clone() }
    }
    pub fn timeout_secs(mut self, s: u64) -> Self {
        self.timeout = Duration::from_secs(s);
        self
    }
    pub fn text(mut self) -> Self {
        self.json = false;
        self
    }
}

#[derive(Debug, Clone)]
pub struct Hc {
    pub bin: String,
}

impl Hc {
    pub fn from_env() -> Self {
        Self { bin: std::env::var("HC_BIN").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "hc".into()) }
    }

    pub async fn run(&self, args: &[&str], opts: HcOpts) -> HcResult {
        let sub = args.first().copied().unwrap_or("");
        // --json right after the subcommand, so it never lands after a `--`.
        let mut argv: Vec<&str> = Vec::with_capacity(args.len() + 1);
        argv.push(sub);
        if opts.json {
            argv.push("--json");
        }
        argv.extend_from_slice(args.get(1..).unwrap_or(&[]));

        let out = exec(&self.bin, &argv, &opts, &format!("hc {sub}")).await?;

        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        if opts.json {
            let t = stdout.trim();
            if t.starts_with('{')
                && let Ok(data) = serde_json::from_str::<Value>(t)
            {
                return Ok(HcOk { data, text: t.to_string() });
            }
        } else if out.status.success() {
            return Ok(HcOk { data: Value::Null, text: stdout });
        }
        Err(parse_hc_error(&stderr).unwrap_or_else(|| {
            let code = out.status.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".into());
            let msg = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
            let msg: String = msg.chars().take(500).collect();
            HcError::new(format!("exit {code}"), if msg.is_empty() { "hc failed".into() } else { msg })
        }))
    }
}

/// Run `bin argv`, bounded by `opts.timeout` and `opts.cancel`.
async fn exec(bin: &str, argv: &[&str], opts: &HcOpts, what: &str) -> Result<Output, HcError> {
    let child = Command::new(bin)
        .args(argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| HcError::new("spawn failed", format!("could not run {bin}: {e}")))?;

    // Dropping the output future drops the child, and kill_on_drop kills it:
    // this is how Esc (request cancellation) ends a long `hc wait`.
    tokio::select! {
        r = child.wait_with_output() => r.map_err(|e| HcError::new("io", format!("{what}: {e}"))),
        _ = tokio::time::sleep(opts.timeout) => Err(HcError::new("timed out", format!("{what} timed out"))),
        _ = opts.cancel.cancelled() => Err(HcError::new("cancelled", format!("{what} cancelled"))),
    }
}

/// The Herdr window (`herdr-app`): only for changing what the person sees.
#[derive(Debug, Clone)]
pub struct App {
    pub bin: String,
}

impl App {
    pub fn from_env() -> Self {
        Self {
            bin: std::env::var("HERDR_APP_BIN").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "herdr-app".into()),
        }
    }

    /// `herdr-app ls`: spaces > tabs > terminals with pane ids.
    pub async fn ls(&self, cancel: &CancellationToken) -> Result<Value, HcError> {
        self.call(&["ls"], cancel).await
    }

    /// `herdr-app status`: the shown space and tab, and the focused pane.
    pub async fn status(&self, cancel: &CancellationToken) -> Result<Value, HcError> {
        self.call(&["status"], cancel).await
    }

    /// `herdr-app do <cmd> '<json args>'`.
    pub async fn do_(&self, cmd: &str, args: Value, cancel: &CancellationToken) -> Result<Value, HcError> {
        let a = args.to_string();
        self.call(&["do", cmd, &a], cancel).await
    }

    async fn call(&self, argv: &[&str], cancel: &CancellationToken) -> Result<Value, HcError> {
        let opts = HcOpts::new(cancel).timeout_secs(15);
        let what = format!("herdr-app {}", argv.get(1).or(argv.first()).unwrap_or(&""));
        let out = exec(&self.bin, argv, &opts, &what).await?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        let parsed = serde_json::from_str::<Value>(stdout.trim()).ok();
        if let Some(e) = parsed.as_ref().and_then(|v| v.get("error")) {
            let msg = e.as_str().map(String::from).unwrap_or_else(|| e.to_string());
            return Err(HcError::new("herdr-app", format!("{what}: {msg}")));
        }
        match parsed {
            Some(v) if out.status.success() => Ok(v),
            _ => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                let msg = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
                let msg: String = msg.chars().take(300).collect();
                Err(HcError::new(
                    "herdr-app",
                    format!(
                        "{what} failed: {}",
                        if msg.is_empty() { "no output (is the Herdr window open?)" } else { &msg }
                    ),
                ))
            }
        }
    }
}
