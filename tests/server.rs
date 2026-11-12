//! Stdio integration tests: a real MCP client drives the server binary, with
//! HC_BIN pointing at tests/fake-hc.sh (canned hc JSON).

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use rmcp::model::{CallToolRequestParams, ClientRequest, ProgressNotificationParam, Request};
use rmcp::service::{NotificationContext, PeerRequestOptions, RoleClient, RunningService};
use rmcp::transport::TokioChildProcess;
use rmcp::{ClientHandler, ServiceExt};
use serde_json::{Value, json};

#[derive(Clone, Default)]
struct Client {
    progress: Arc<AtomicUsize>,
}

impl ClientHandler for Client {
    async fn on_progress(&self, _p: ProgressNotificationParam, _c: NotificationContext<RoleClient>) {
        self.progress.fetch_add(1, Ordering::SeqCst);
    }
}

struct Harness {
    client: RunningService<RoleClient, Client>,
    progress: Arc<AtomicUsize>,
    log: PathBuf,
    dir: tempfile::TempDir,
}

fn fake_hc() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fake-hc.sh")
}

async fn start(env: &[(&str, &str)]) -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("hc.log");
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_herdr-subagents-mcp"));
    // Tests run inside real herdr terminals: never let real hc ids leak in.
    cmd.env_remove("HC_TERMINAL_ID")
        .env_remove("HC_SUBAGENT_ROLE")
        .env("HC_BIN", fake_hc())
        .env("FAKE_HC_LOG", &log)
        .env("XDG_CONFIG_HOME", dir.path())
        .env("HERDR_MCP_PROGRESS_MS", "100");
    for (k, v) in env {
        cmd.env(k, v);
    }
    let handler = Client::default();
    let progress = handler.progress.clone();
    let client = handler.serve(TokioChildProcess::new(cmd).unwrap()).await.unwrap();
    Harness { client, progress, log, dir }
}

const PARENT: &[(&str, &str)] = &[("HC_TERMINAL_ID", "t1")];

impl Harness {
    async fn tool_names(&self) -> Vec<String> {
        self.client.list_all_tools().await.unwrap().into_iter().map(|t| t.name.to_string()).collect()
    }

    async fn call(&self, name: &str, args: Value) -> (String, bool) {
        let p =
            CallToolRequestParams::new(name.to_string()).with_arguments(args.as_object().cloned().unwrap_or_default());
        let r = self.client.call_tool(p).await.unwrap();
        let content = serde_json::to_value(&r.content).unwrap();
        let text = content[0]["text"].as_str().unwrap_or("").to_string();
        (text, r.is_error == Some(true))
    }

    fn log(&self) -> Vec<String> {
        std::fs::read_to_string(&self.log).unwrap_or_default().lines().map(String::from).collect()
    }
}

#[tokio::test]
async fn no_terminal_means_no_tools() {
    let h = start(&[]).await;
    assert!(h.tool_names().await.is_empty());
}

#[tokio::test]
async fn child_gets_only_report() {
    let h = start(&[("HC_TERMINAL_ID", "t3f"), ("HC_SUBAGENT_ROLE", "scout")]).await;
    assert_eq!(h.tool_names().await, vec!["subagent_report"]);
    let (t, err) = h.call("subagent_report", json!({"message":"all done"})).await;
    assert!(!err, "{t}");
    assert_eq!(t, "reported to t1.");
    let log = h.log();
    assert!(log.iter().any(|l| l == "get|--json|t3f|"), "{log:?}");
    assert!(log.iter().any(|l| l == "send|--json|t1|all done|"), "{log:?}");
    // parent is resolved once
    h.call("subagent_report", json!({"message":"again"})).await;
    assert_eq!(h.log().iter().filter(|l| l.starts_with("get|")).count(), 1);
    // parent tools are not callable from a child
    let p = CallToolRequestParams::new("subagent_spawn").with_arguments(Default::default());
    assert!(h.client.call_tool(p).await.is_err());
}

#[tokio::test]
async fn parent_tools_and_role_enum() {
    let h = start(PARENT).await;
    let tools = h.client.list_all_tools().await.unwrap();
    let names: Vec<_> = tools.iter().map(|t| t.name.to_string()).collect();
    assert_eq!(
        names,
        ["subagent_spawn", "subagent_send", "subagent_wait", "subagent_read", "subagent_stop", "subagent_list"]
    );
    let spawn = &tools[0];
    assert_eq!(spawn.input_schema["properties"]["role"]["enum"], json!(["scout", "reviewer"]));
    let desc = spawn.description.as_deref().unwrap();
    assert!(desc.contains("- scout: Fast lookup"));
    assert!(desc.contains("never sleep or poll"));
}

#[tokio::test]
async fn spawn_passes_parent_separator_and_unique_name() {
    let h = start(PARENT).await;
    let (t, err) = h.call("subagent_spawn", json!({"role":"scout","task":"find foo","cwd":"/tmp"})).await;
    assert!(!err, "{t}");
    assert!(t.contains("spawned scout-2 (t40)"), "{t}");
    let run = h.log().into_iter().find(|l| l.starts_with("run|")).unwrap();
    assert_eq!(run, "run|--json|--bg|--parent|t1|--name|scout-2|--cwd|/tmp|--|scout|find foo|");
}

#[tokio::test]
async fn spawn_undelivered_is_error() {
    let h = start(&[("HC_TERMINAL_ID", "t1"), ("FAKE_HC_UNDELIVERED", "1")]).await;
    let (t, err) = h.call("subagent_spawn", json!({"role":"scout","task":"x"})).await;
    assert!(err);
    assert!(t.contains("do not resend blindly"), "{t}");
}

#[tokio::test]
async fn spawn_without_templates_explains_init() {
    let h = start(&[("HC_TERMINAL_ID", "t1"), ("FAKE_HC_NO_TEMPLATES", "1")]).await;
    let tools = h.client.list_all_tools().await.unwrap();
    assert_eq!(tools.len(), 6);
    assert!(tools[0].input_schema["properties"]["role"].get("enum").is_none());
    let (t, err) = h.call("subagent_spawn", json!({"role":"scout","task":"x"})).await;
    assert!(err);
    assert!(t.contains("no role templates") && t.contains(" init`"), "{t}");
    assert!(!h.log().iter().any(|l| l.starts_with("run|")));
}

#[tokio::test]
async fn send_wait_reads_nested_wait() {
    let h = start(PARENT).await;
    let (t, err) = h.call("subagent_send", json!({"to":"scout","message":"go on","wait":true,"timeout":30})).await;
    assert!(!err, "{t}");
    assert!(t.contains("scout: done"), "{t}");
    assert!(!t.contains('?'), "{t}");
    assert!(h.log().iter().any(|l| l == "send|--json|--wait|--timeout|30|scout|go on|"));
    let (t, _) = h.call("subagent_send", json!({"to":"scout","message":"hi"})).await;
    assert_eq!(t, "sent to scout (was idle).");
    assert!(!h.log().iter().any(|l| l.contains("--force")));
}

#[tokio::test]
async fn blocked_error_is_reported() {
    let h = start(&[("HC_TERMINAL_ID", "t1"), ("FAKE_HC_ERR", "blocked")]).await;
    let (t, err) = h.call("subagent_send", json!({"to":"scout","message":"hi"})).await;
    assert!(err);
    assert!(t.starts_with("blocked: t3f is blocked"), "{t}");
    assert!(t.contains("tell the user; do not bypass"), "{t}");
}

#[tokio::test]
async fn wait_read_stop_list() {
    let h = start(PARENT).await;
    let (t, _) = h.call("subagent_wait", json!({})).await;
    assert!(t.contains("scout (t3f): done"), "{t}");
    assert!(h.log().iter().any(|l| l == "wait|--json|--children|any|--timeout|180|"));

    let (t, _) = h.call("subagent_read", json!({"name":"scout"})).await;
    assert_eq!(t, "line one\n\nline two");
    assert!(h.log().iter().any(|l| l == "read|--lines|60|scout|"), "read must not get --json");

    let (t, err) = h.call("subagent_stop", json!({"name":"scout","kill":true})).await;
    assert!(!err, "{t}");
    assert_eq!(t, "killed and removed scout.");
    let (t, _) = h.call("subagent_stop", json!({"name":"scout"})).await;
    assert_eq!(t, "interrupt scout: stopped.");

    let (t, _) = h.call("subagent_list", json!({})).await;
    assert_eq!(t, "scout (t3f) scout: idle");
}

#[tokio::test]
async fn progress_during_slow_wait() {
    let h = start(&[("HC_TERMINAL_ID", "t1"), ("FAKE_HC_SLOW", "1")]).await;
    h.call("subagent_wait", json!({"timeout":5})).await;
    assert!(h.progress.load(Ordering::SeqCst) >= 3, "progress = {}", h.progress.load(Ordering::SeqCst));
}

#[tokio::test]
async fn cancel_kills_hc_wait() {
    let pidfile = tempfile::NamedTempFile::new().unwrap();
    let pidpath = pidfile.path().to_str().unwrap().to_string();
    std::fs::write(&pidpath, "").unwrap();
    let h = start(&[("HC_TERMINAL_ID", "t1"), ("FAKE_HC_SLOW", "30"), ("FAKE_HC_PIDFILE", &pidpath)]).await;
    let p = CallToolRequestParams::new("subagent_wait").with_arguments(Default::default());
    let handle = h
        .client
        .peer()
        .send_cancellable_request(ClientRequest::CallToolRequest(Request::new(p)), PeerRequestOptions::no_options())
        .await
        .unwrap();

    let mut pid = String::new();
    for _ in 0..50 {
        pid = std::fs::read_to_string(&pidpath).unwrap().trim().to_string();
        if !pid.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(!pid.is_empty(), "fake hc wait never started");
    let alive = |pid: &str| std::process::Command::new("kill").args(["-0", pid]).status().unwrap().success();
    assert!(alive(&pid));

    handle.cancel(Some("test".into())).await.unwrap();
    let mut dead = false;
    for _ in 0..30 {
        if !alive(&pid) {
            dead = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(dead, "hc wait {pid} survived cancellation");
    drop(h.dir);
}
