//! Compact text for tool results. hc speaks JSON; the model only needs a line
//! or two plus the next sensible step. Pure: no I/O.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HcError {
    pub kind: String,
    pub message: String,
    pub hint: Option<String>,
}

impl HcError {
    pub fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self { kind: kind.into(), message: message.into(), hint: None }
    }
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct WaitResult {
    pub reason: Option<String>,
    pub status: Option<String>,
    pub terminal: Option<String>,
    pub ended: Option<bool>,
    pub exit_code: Option<i64>,
    pub children: Vec<WaitResult>,
}

impl WaitResult {
    /// Lenient parse: unknown or oddly typed fields become defaults.
    pub fn from_value(v: &Value) -> Self {
        serde_json::from_value(v.clone()).unwrap_or_else(|_| WaitResult {
            reason: v.get("reason").and_then(Value::as_str).map(String::from),
            status: v.get("status").and_then(Value::as_str).map(String::from),
            terminal: v.get("terminal").and_then(Value::as_str).map(String::from),
            ..Default::default()
        })
    }
}

/// hc names: 1-32 of a-z 0-9 - _
pub fn sanitize_name(raw: &str) -> String {
    let lower = raw.to_lowercase();
    let mut out = String::new();
    let mut in_bad_run = false;
    for c in lower.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-' {
            out.push(c);
            in_bad_run = false;
        } else if !in_bad_run {
            out.push('-');
            in_bad_run = true;
        }
    }
    let trimmed = out.trim_matches('-');
    let s: String = trimmed.chars().take(32).collect();
    if s.is_empty() { "agent".into() } else { s }
}

/// First free name among live terminals: base, base-2, base-3, ...
pub fn unique_name<'a>(base: &str, taken: impl IntoIterator<Item = &'a str>) -> String {
    let used: HashSet<&str> = taken.into_iter().collect();
    let clean = sanitize_name(base);
    if !used.contains(clean.as_str()) {
        return clean;
    }
    for i in 2.. {
        let suffix = format!("-{i}");
        let keep = 32usize.saturating_sub(suffix.len()).min(clean.len());
        let candidate = format!("{}{}", &clean[..keep], suffix);
        if !used.contains(candidate.as_str()) {
            return candidate;
        }
    }
    unreachable!()
}

pub fn format_error(err: &HcError) -> String {
    let base = format!("{}: {}", err.kind, err.message);
    match err.kind.as_str() {
        "blocked" => format!("{base}. It needs a person (permission or question): tell the user; do not bypass."),
        "not_found" => format!("{base}. It may have exited and been removed."),
        "finished" => format!("{base}. It has exited; subagent_read shows its last output."),
        _ => match &err.hint {
            Some(h) => format!("{base} ({h})"),
            None => base,
        },
    }
}

pub fn format_spawn(name: &str, data: &Value) -> String {
    let addr = data.get("address").and_then(Value::as_str).unwrap_or("?");
    let fm = data.get("first_message");
    if fm.and_then(|f| f.get("sent")).and_then(Value::as_bool) == Some(false) {
        let reason = fm.and_then(|f| f.get("reason")).and_then(Value::as_str).unwrap_or("unknown reason");
        return format!(
            "spawned {name} ({addr}) but the task was NOT delivered ({reason}). Use subagent_read {name} to see why before resending; do not resend blindly."
        );
    }
    format!(
        "spawned {name} ({addr}); it will report back as an <hc from=\"{addr} {name}\"> message. Keep working, or subagent_wait."
    )
}

fn describe(r: &WaitResult, names: &HashMap<String, String>) -> String {
    let addr = r.terminal.as_deref().unwrap_or("?");
    let label = match names.get(addr) {
        Some(n) => format!("{n} ({addr})"),
        None => addr.to_string(),
    };
    if let Some(code) = r.exit_code {
        return format!("{label}: exited {code}");
    }
    let status =
        r.status.clone().unwrap_or_else(|| if r.ended == Some(true) { "stopped".into() } else { "working".into() });
    format!("{label}: {status}")
}

fn status_hint(s: &str) -> Option<&'static str> {
    match s {
        "blocked" => Some("blocked needs a person: subagent_read it and tell the user."),
        "error" => Some("error: subagent_read it, then subagent_send a fix or subagent_stop."),
        _ => None,
    }
}

pub fn format_wait(r: &WaitResult, names: &HashMap<String, String>) -> String {
    let mut lines: Vec<String> = Vec::new();
    let reason = r.reason.as_deref();
    match reason {
        Some("message") => lines.push(
            "Stopped waiting: a message is arriving as your next input (not output to fetch). Handle it, then wait again if needed.".into(),
        ),
        Some("timeout") => lines.push("Check-in (timeout), not a failure. Call subagent_wait again or do other work.".into()),
        _ => {}
    }
    if !r.children.is_empty() {
        lines.push(r.children.iter().map(|k| describe(k, names)).collect::<Vec<_>>().join("; "));
    } else if reason != Some("message") && reason != Some("timeout") {
        lines.push(describe(r, names));
    }
    // Insertion order matters for stable output: own status first, then children.
    let mut statuses: Vec<&str> = Vec::new();
    let mut seen = BTreeSet::new();
    for s in r.status.iter().chain(r.children.iter().filter_map(|k| k.status.as_ref())) {
        if seen.insert(s.as_str()) {
            statuses.push(s.as_str());
        }
    }
    for s in &statuses {
        if let Some(h) = status_hint(s) {
            lines.push(h.into());
        }
    }
    if statuses.iter().any(|s| *s == "done" || *s == "idle") {
        lines.push("Its report (if sent) arrives as an <hc from=...> message; otherwise subagent_read it.".into());
    }
    lines.join("\n")
}

/// Drop the blank padding hc's screen dump carries and collapse blank runs.
pub fn clean_screen(text: &str) -> String {
    let mut out = String::new();
    let mut blank_run = 0;
    for line in text.split('\n') {
        let l = line.trim_end();
        if l.is_empty() {
            blank_run += 1;
            if blank_run > 1 {
                continue;
            }
        } else {
            blank_run = 0;
        }
        out.push_str(l);
        out.push('\n');
    }
    out.trim().to_string()
}

/// Keep the last max_lines / max_bytes of text.
pub fn tail(text: &str, max_lines: usize, max_bytes: usize) -> (String, bool) {
    let mut lines: Vec<&str> = text.split('\n').collect();
    let mut truncated = false;
    if lines.len() > max_lines {
        lines = lines.split_off(lines.len() - max_lines);
        truncated = true;
    }
    let mut out = lines.join("\n");
    while out.len() > max_bytes && lines.len() > 1 {
        lines.remove(0);
        out = lines.join("\n");
        truncated = true;
    }
    (out, truncated)
}

/// Pane id showing terminal `addr`, from `herdr-app ls` (spaces > tabs > terminals).
pub fn pane_of(ls: &Value, addr: &str) -> Option<String> {
    let arr = |v: &Value, k: &str| v.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
    arr(ls, "spaces")
        .iter()
        .flat_map(|s| arr(s, "tabs"))
        .flat_map(|t| arr(&t, "terminals"))
        .find(|t| t.get("terminal").and_then(Value::as_str) == Some(addr))
        .and_then(|t| t.get("pane").and_then(Value::as_str).map(String::from))
}

/// The tab showing terminal `addr` in a pane: (tab id, [(terminal, pane)] of that tab's panes in order).
pub fn tab_panes(ls: &Value, addr: &str) -> Option<(String, Vec<(String, String)>)> {
    let arr = |v: &Value, k: &str| v.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
    let s = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(String::from);
    let tab = arr(ls, "spaces").iter().flat_map(|sp| arr(sp, "tabs")).find(|t| {
        arr(t, "terminals").iter().any(|x| s(x, "terminal").as_deref() == Some(addr) && s(x, "pane").is_some())
    })?;
    let panes = arr(&tab, "terminals").iter().filter_map(|x| Some((s(x, "terminal")?, s(x, "pane")?))).collect();
    Some((s(&tab, "id")?, panes))
}

pub fn parse_hc_error(stderr: &str) -> Option<HcError> {
    for line in stderr.split('\n').rev() {
        let t = line.trim();
        if !t.starts_with('{') {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(t) else { continue };
        let Some(e) = v.get("error") else { continue };
        let Some(kind) = e.get("kind").and_then(Value::as_str) else { continue };
        return Some(HcError {
            kind: kind.into(),
            message: match e.get("message") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Null) | None => String::new(),
                Some(other) => other.to_string(),
            },
            hint: e.get("hint").and_then(Value::as_str).map(String::from),
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pane_of_walks_spaces_and_tabs() {
        let ls = json!({"spaces":[{"tabs":[{"terminals":[{"terminal":"t1","pane":"p0"}]},
            {"terminals":[{"terminal":"t2","pane":null},{"terminal":"t3f","pane":"p1"}]}]}]});
        assert_eq!(pane_of(&ls, "t3f").as_deref(), Some("p1"));
        assert_eq!(pane_of(&ls, "t1").as_deref(), Some("p0"));
        assert_eq!(pane_of(&ls, "t2"), None);
        assert_eq!(pane_of(&ls, "t9"), None);
        assert_eq!(pane_of(&json!({}), "t1"), None);
    }

    #[test]
    fn tab_panes_finds_the_shown_tab() {
        let ls = json!({"spaces":[{"tabs":[{"id":"tb0","terminals":[{"terminal":"t1","pane":null}]},
            {"id":"tb1","terminals":[{"terminal":"t2","pane":"p2"},{"terminal":"t1","pane":"p1"},{"terminal":"t4","pane":null}]}]}]});
        let (tab, panes) = tab_panes(&ls, "t1").unwrap();
        assert_eq!(tab, "tb1");
        assert_eq!(panes, [("t2".to_string(), "p2".to_string()), ("t1".into(), "p1".into())]);
        assert_eq!(tab_panes(&ls, "t4"), None);
    }

    fn names() -> HashMap<String, String> {
        HashMap::from([("t3f".to_string(), "scout".to_string())])
    }
    fn wait(v: Value) -> WaitResult {
        WaitResult::from_value(&v)
    }

    #[test]
    fn sanitize_to_hc_alphabet_and_length() {
        assert_eq!(sanitize_name("Review Auth!"), "review-auth");
        assert_eq!(sanitize_name(&"x".repeat(40)).len(), 32);
        assert_eq!(sanitize_name("!!!"), "agent");
    }

    #[test]
    fn unique_name_adds_suffix_within_32() {
        assert_eq!(unique_name("scout", []), "scout");
        assert_eq!(unique_name("scout", ["scout", "scout-2"]), "scout-3");
        let long = "a".repeat(32);
        let u = unique_name(&long, [long.as_str()]);
        assert_eq!(u.len(), 32);
        assert!(u.ends_with("-2"));
    }

    #[test]
    fn spawn_delivered() {
        let s = format_spawn("scout", &json!({"address":"t3f","first_message":{"sent":true}}));
        assert!(s.contains("spawned scout (t3f)"));
    }

    #[test]
    fn spawn_undelivered_warns() {
        let s = format_spawn("scout", &json!({"address":"t3f","first_message":{"sent":false,"reason":"dialog"}}));
        assert!(s.contains("NOT delivered (dialog)"));
        assert!(s.contains("do not resend blindly"));
    }

    #[test]
    fn wait_children_done_with_report_hint() {
        let s = format_wait(
            &wait(
                json!({"reason":"children","children":[{"terminal":"t3f","status":"done","ended":true,"exit_code":null}]}),
            ),
            &names(),
        );
        assert!(s.contains("scout (t3f): done"));
        assert!(s.contains("<hc from="));
    }

    #[test]
    fn wait_timeout_is_checkin() {
        let s = format_wait(
            &wait(json!({"reason":"timeout","children":[{"terminal":"t3f","status":"working"}]})),
            &names(),
        );
        assert!(s.contains("Check-in"));
        assert!(s.contains("scout (t3f): working"));
    }

    #[test]
    fn wait_message_means_input() {
        assert!(format_wait(&wait(json!({"reason":"message","children":[]})), &names()).contains("next input"));
    }

    #[test]
    fn wait_blocked_hint_exit_code_wins() {
        let s = format_wait(
            &wait(
                json!({"reason":"children","children":[{"terminal":"t3f","status":"blocked"},{"terminal":"t40","exit_code":1}]}),
            ),
            &names(),
        );
        assert!(s.contains("blocked needs a person"));
        assert!(s.contains("t40: exited 1"));
    }

    #[test]
    fn wait_single_target() {
        let s = format_wait(&wait(json!({"reason":"status","status":"done","terminal":"t3f","children":[]})), &names());
        assert!(s.contains("scout (t3f): done"));
    }

    #[test]
    fn wait_tolerates_odd_fields() {
        // full hc shape, including signal and nulls
        let s = format_wait(
            &wait(
                json!({"children":[],"ended":true,"exit_code":null,"reason":"status","signal":null,"status":"done","terminal":"t3f","turn":1}),
            ),
            &names(),
        );
        assert!(s.contains("scout (t3f): done"));
    }

    #[test]
    fn parse_hc_stderr_json() {
        let e = parse_hc_error(
            "noise\n{\"error\":{\"hint\":\"see `hc ls --all`\",\"kind\":\"not_found\",\"message\":\"no terminal \\\"x\\\"\"}}\n",
        );
        assert_eq!(
            e,
            Some(HcError {
                kind: "not_found".into(),
                message: "no terminal \"x\"".into(),
                hint: Some("see `hc ls --all`".into())
            })
        );
        assert_eq!(parse_hc_error("plain failure"), None);
    }

    #[test]
    fn blocked_never_suggests_bypass() {
        assert!(format_error(&HcError::new("blocked", "t3f is blocked")).contains("tell the user; do not bypass"));
    }

    #[test]
    fn clean_screen_strips_padding() {
        assert_eq!(clean_screen("  a  \n\n\n\n b \n   \n\n"), "a\n\n b");
    }

    #[test]
    fn tail_keeps_end() {
        assert_eq!(tail("1\n2\n3\n4", 2, 100), ("3\n4".to_string(), true));
        assert_eq!(tail(&format!("{}\nend", "x".repeat(50)), 10, 10).0, "end");
    }
}
