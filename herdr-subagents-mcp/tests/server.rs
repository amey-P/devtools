//! Stdio integration tests: a real MCP client drives the server binary, with
//! HC_BIN pointing at tests/fake-hc.sh and HERDR_APP_BIN at tests/fake-herdr-app.sh (canned JSON).

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

fn fake(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join(name)
}

async fn start(env: &[(&str, &str)]) -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("hc.log");
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_herdr-subagents-mcp"));
    // Tests run inside real herdr terminals: never let real hc ids leak in.
    cmd.env_remove("HC_TERMINAL_ID")
        .env_remove("HC_SUBAGENT_ROLE")
        .env("HC_BIN", fake("fake-hc.sh"))
        .env("FAKE_HC_LOG", &log)
        .env("HERDR_APP_BIN", fake("fake-herdr-app.sh"))
        .env("FAKE_APP_LOG", dir.path().join("app.log"))
        .env("XDG_CONFIG_HOME", dir.path())
        .env("HERDR_MCP_PROGRESS_MS", "100")
        .env("HERDR_MCP_SETTLE_MS", "50");
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

    fn app_log(&self) -> Vec<String> {
        std::fs::read_to_string(self.dir.path().join("app.log")).unwrap_or_default().lines().map(String::from).collect()
    }

    /// The `do|…` lines of the app log, once background placement has settled:
    /// waits until the log has `want` (or 2 s pass), then a little longer for trailing calls.
    async fn app_dos_after(&self, want: &str) -> Vec<String> {
        let dos = || self.app_log().into_iter().filter(|l| l.starts_with("do|")).collect::<Vec<_>>();
        for _ in 0..40 {
            if dos().iter().any(|l| l.contains(want)) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        dos()
    }

    fn run_line(&self) -> String {
        self.log().into_iter().find(|l| l.starts_with("run|")).expect("no hc run")
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
    // reporting parks the child's own pane
    assert!(h.app_log().iter().any(|l| l == r#"do|terminal.park|{"terminal":"t3f"}|"#), "{:?}", h.app_log());
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
        [
            "subagent_spawn",
            "subagent_send",
            "subagent_wait",
            "subagent_read",
            "subagent_stop",
            "subagent_list",
            "subagent_layout"
        ]
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
    assert!(t.contains("Not shown"), "{t}");
    assert_eq!(h.run_line(), "run|--json|--bg|--parent|t1|--name|scout-2|--cwd|/tmp|--|scout|find foo|");
}

const SHOWN: &[(&str, &str)] = &[("HC_TERMINAL_ID", "t1"), ("FAKE_HC_LABELS", "1")];

#[tokio::test]
async fn spawn_is_shown_in_parent_tab_by_default() {
    let h = start(SHOWN).await;
    let (t, err) = h.call("subagent_spawn", json!({"role":"scout","task":"find foo","cwd":"/tmp"})).await;
    assert!(!err, "{t}");
    assert!(!t.contains("Not shown") && t.contains("appears in your tab"), "{t}");
    // started headless, then placed by the server
    assert_eq!(h.run_line(), "run|--json|--bg|--parent|t1|--name|scout-2|--cwd|/tmp|--|scout|find foo|");
    // t3f (80x40) is the only child pane: halve it down, then focus goes back to the parent.
    // t8 is someone else's pane and is never measured.
    assert_eq!(
        h.app_dos_after("terminal.keep").await,
        [
            r#"do|pane.focus|{"pane":"p1"}|"#,
            r#"do|terminal.keep|{"place":"down","terminal":"t40"}|"#,
            r#"do|pane.focus|{"pane":"p0"}|"#,
        ]
    );
    assert!(!h.log().iter().any(|l| l == "get|--json|t8|"), "{:?}", h.log());
}

#[tokio::test]
async fn first_child_splits_parent_right() {
    let h = start(&[("HC_TERMINAL_ID", "t1"), ("FAKE_HC_LABELS", "1"), ("FAKE_APP_PARKED", "1")]).await;
    let (t, err) = h.call("subagent_spawn", json!({"role":"scout","task":"x","cwd":"/tmp"})).await;
    assert!(!err, "{t}");
    assert_eq!(
        h.app_dos_after("terminal.keep").await,
        [r#"do|pane.focus|{"pane":"p0"}|"#, r#"do|terminal.keep|{"place":"right","terminal":"t40"}|"#]
    );
}

#[tokio::test]
async fn no_room_goes_to_a_new_tab() {
    let h = start(&[("HC_TERMINAL_ID", "t1"), ("FAKE_HC_LABELS", "1"), ("FAKE_HC_SMALL", "1")]).await;
    let (t, err) = h.call("subagent_spawn", json!({"role":"scout","task":"x","cwd":"/tmp"})).await;
    assert!(!err, "{t}");
    assert_eq!(h.app_dos_after("terminal.keep").await, [r#"do|terminal.keep|{"place":"tab","terminal":"t40"}|"#]);
}

#[tokio::test]
async fn other_tab_shown_falls_back_to_labels() {
    let h = start(&[("HC_TERMINAL_ID", "t1"), ("FAKE_HC_LABELS", "1"), ("FAKE_APP_OTHER_TAB", "1")]).await;
    let (t, err) = h.call("subagent_spawn", json!({"role":"scout","task":"x","cwd":"/tmp"})).await;
    assert!(!err, "{t}");
    for _ in 0..40 {
        if h.log().iter().any(|l| l.starts_with("label|")) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(h.log().iter().any(|l| l == "label|--json|t40|herdr.space=sp1|herdr.tab=tb1|"), "{:?}", h.log());
    assert!(h.app_log().iter().all(|l| !l.starts_with("do|")), "{:?}", h.app_log());
}

#[tokio::test]
async fn send_reshows_a_parked_child_unless_hidden() {
    let h = start(&[("HC_TERMINAL_ID", "t1"), ("FAKE_HC_LABELS", "1"), ("FAKE_APP_PARKED", "1")]).await;
    // show opts t3f into automatic panes (and places it)
    let (t, err) = h.call("subagent_layout", json!({"name":"scout","action":"show"})).await;
    assert!(!err && t.contains("shown in your tab"), "{t}");
    let keeps = |h: &Harness| h.app_log().iter().filter(|l| l.contains("terminal.keep")).count();
    assert_eq!(keeps(&h), 1);
    // it reported and parked itself (FAKE_APP_PARKED); new work brings the pane back
    let (t, err) = h.call("subagent_send", json!({"to":"scout","message":"one more"})).await;
    assert!(!err, "{t}");
    h.app_dos_after("NEVER").await;
    assert_eq!(keeps(&h), 2);
    // hide opts it out
    h.call("subagent_layout", json!({"name":"scout","action":"hide"})).await;
    h.call("subagent_send", json!({"to":"scout","message":"again"})).await;
    h.app_dos_after("NEVER").await;
    assert_eq!(keeps(&h), 2);
}

#[tokio::test]
async fn spawn_visible_false_stays_headless() {
    let h = start(SHOWN).await;
    let (t, err) = h.call("subagent_spawn", json!({"role":"scout","task":"x","cwd":"/tmp","visible":false})).await;
    assert!(!err, "{t}");
    assert!(!t.contains("Not shown"), "{t}");
    assert!(!h.run_line().contains("--label"));
    assert!(!h.log().iter().any(|l| l.starts_with("get|")), "no label lookup when hidden");
    assert!(h.app_dos_after("NEVER").await.is_empty(), "never placed");
}

#[tokio::test]
async fn spawn_program_waits_then_sends_task() {
    let h = start(SHOWN).await;
    let (t, err) =
        h.call("subagent_spawn", json!({"program":["/usr/local/bin/claude"],"task":"fix it","cwd":"/tmp"})).await;
    assert!(!err, "{t}");
    assert!(t.contains("spawned claude (t40)"), "{t}");
    let log = h.log();
    let pos = |p: &str| log.iter().position(|l| l.starts_with(p)).unwrap_or_else(|| panic!("no {p} in {log:?}"));
    assert_eq!(
        log[pos("run|")],
        "run|--json|--bg|--parent|t1|--name|claude|--cwd|/tmp|--|env|HC_SUBAGENT_ROLE=custom|/usr/local/bin/claude|"
    );
    assert_eq!(log[pos("wait|")], "wait|--json|t40|--timeout|60|");
    // the task has real newlines, so the logged send spans lines
    assert_eq!(log[pos("send|")], "send|--json|t40|fix it");
    let all = log.join("\n");
    assert!(all.contains("fix it\n\nWhen done or stuck, report with the subagent_report tool"), "{all}");
    assert!(all.contains("hc send t1"), "{all}");
    assert!(pos("run|") < pos("wait|") && pos("wait|") < pos("send|"));
}

#[tokio::test]
async fn spawn_program_without_task_just_starts() {
    let h = start(PARENT).await;
    let (t, err) = h.call("subagent_spawn", json!({"program":["npm","run","dev"],"cwd":"/tmp","name":"web"})).await;
    assert!(!err, "{t}");
    assert!(t.starts_with("started web (t40)."), "{t}");
    assert!(h.run_line().ends_with("|--|env|HC_SUBAGENT_ROLE=custom|npm|run|dev|"), "{}", h.run_line());
    assert!(!h.log().iter().any(|l| l.starts_with("wait|") || l.starts_with("send|")));
}

#[tokio::test]
async fn spawn_program_not_ready_does_not_send() {
    let h = start(&[("HC_TERMINAL_ID", "t1"), ("FAKE_HC_NOT_READY", "1")]).await;
    let (t, err) = h.call("subagent_spawn", json!({"program":["claude"],"task":"x"})).await;
    assert!(err);
    assert!(t.contains("task was NOT sent") && t.contains("blocked"), "{t}");
    assert!(!h.log().iter().any(|l| l.starts_with("send|")));
}

#[tokio::test]
async fn spawn_needs_exactly_one_of_role_or_program() {
    let h = start(PARENT).await;
    let (t, err) = h.call("subagent_spawn", json!({"role":"scout","program":["claude"],"task":"x"})).await;
    assert!(err && t.contains("not both"), "{t}");
    let (t, err) = h.call("subagent_spawn", json!({"task":"x"})).await;
    assert!(err && t.contains("role or program is required"), "{t}");
    let (t, err) = h.call("subagent_spawn", json!({"role":"scout"})).await;
    assert!(err && t.contains("task is required"), "{t}");
    assert!(!h.log().iter().any(|l| l.starts_with("run|")));
}

#[tokio::test]
async fn layout_acts_on_own_panes() {
    let h = start(SHOWN).await;
    let (t, err) = h.call("subagent_layout", json!({"name":"scout","action":"zoom"})).await;
    assert!(!err, "{t}");
    let (t, err) = h.call("subagent_layout", json!({"name":"scout","action":"swap","with":"me"})).await;
    assert!(!err, "{t}");
    let (t, err) = h.call("subagent_layout", json!({"name":"t3f","action":"focus"})).await;
    assert!(!err, "{t}");
    let (t, err) = h.call("subagent_layout", json!({"name":"scout","action":"hide"})).await;
    assert!(!err && t.contains("keeps running"), "{t}");
    let (t, err) = h.call("subagent_layout", json!({"name":"scout","action":"show","place":"tab"})).await;
    assert!(!err, "{t}");
    let app = h.app_log();
    let dos: Vec<_> = app.iter().filter(|l| l.starts_with("do|")).cloned().collect();
    assert_eq!(
        dos,
        [
            r#"do|pane.zoom|{"pane":"p1"}|"#,
            r#"do|pane.swap|{"pane":"p1","target":"p0"}|"#,
            r#"do|pane.focus|{"pane":"p1"}|"#,
            r#"do|terminal.park|{"terminal":"t3f"}|"#,
            r#"do|terminal.keep|{"place":"tab","terminal":"t3f"}|"#,
        ]
    );

    // already has a pane (p1): nothing to do
    let (t, err) = h.call("subagent_layout", json!({"name":"scout","action":"show"})).await;
    assert!(!err && t.contains("already shown"), "{t}");
}

#[tokio::test]
async fn layout_refuses_others_terminals() {
    let h = start(SHOWN).await;
    let (t, err) = h.call("subagent_layout", json!({"name":"other","action":"zoom"})).await;
    assert!(err && t.contains("not one of your subagents"), "{t}");
    let (t, err) = h.call("subagent_layout", json!({"name":"scout","action":"swap","with":"other"})).await;
    assert!(err && t.contains("not one of your subagents"), "{t}");
    assert!(!h.app_log().iter().any(|l| l.starts_with("do|")));
}

#[tokio::test]
async fn layout_reports_closed_window() {
    let h = start(&[("HC_TERMINAL_ID", "t1"), ("FAKE_APP_DOWN", "1")]).await;
    let (t, err) = h.call("subagent_layout", json!({"name":"scout","action":"zoom"})).await;
    assert!(err && t.contains("no window is running"), "{t}");
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
    assert_eq!(tools.len(), 7);
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
