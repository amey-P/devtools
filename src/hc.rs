//! Thin wrapper around the `hc` CLI (no shell). `HC_BIN` overrides the binary.

use std::process::Stdio;
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

        let child = Command::new(&self.bin)
            .args(&argv)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| HcError::new("spawn failed", format!("could not run {}: {e}", self.bin)))?;

        // Dropping the output future drops the child, and kill_on_drop kills it:
        // this is how Esc (request cancellation) ends a long `hc wait`.
        let out = tokio::select! {
            r = child.wait_with_output() => r,
            _ = tokio::time::sleep(opts.timeout) => {
                return Err(HcError::new("timed out", format!("hc {sub} timed out")));
            }
            _ = opts.cancel.cancelled() => {
                return Err(HcError::new("cancelled", format!("hc {sub} cancelled")));
            }
        }
        .map_err(|e| HcError::new("io", format!("hc {sub}: {e}")))?;

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
