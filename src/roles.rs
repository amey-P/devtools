//! Role definitions for herdr subagents.
//!
//! Roles are hc templates (~/.config/herdr-core/templates/<role>.md). hc owns
//! readiness and first-message delivery; this module only knows the default
//! role set, how to render it as template files, and how to pick role
//! templates out of `hc templates --json`. Pure apart from template file writes.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// MCP server name both clients must register. Templates reference
/// `mcp__<SERVER_NAME>__subagent_report`, so it must not change.
pub const SERVER_NAME: &str = "herdr";
/// Env var a role template sets so the child's MCP server knows it is a subagent.
pub const ROLE_ENV: &str = "HC_SUBAGENT_ROLE";
pub const REPORT_TOOL: &str = "subagent_report";
pub const REPORT_TOOL_QUALIFIED: &str = "mcp__herdr__subagent_report";
pub const PI_BIN: &str = "/opt/homebrew/bin/pi";
/// The pi flag the old extension used; recognised during migration only.
pub const LEGACY_ROLE_FLAG: &str = "--subagent-role";

#[derive(Debug, Clone)]
pub struct RoleSpec {
    pub name: &'static str,
    pub description: &'static str,
    /// always provider/id
    pub model: &'static str,
    pub thinking: &'static str,
    pub tools: &'static [&'static str],
    pub instructions: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateInfo {
    pub name: String,
    pub description: String,
    pub command: String,
}

const DEFAULT_MODEL: &str = "opencode-go/deepseek-v4.1-flash";

pub const DEFAULT_ROLES: &[RoleSpec] = &[
    RoleSpec {
        name: "planner",
        description: "Explores code and writes an implementation plan to a file; does not edit source",
        model: DEFAULT_MODEL,
        thinking: "high",
        tools: &["read", "grep", "find", "ls", "write"],
        instructions: "You are a planner. Investigate the code needed for the task, then write a concise, step-by-step implementation plan to a markdown file (use the path in the task, else ./PLAN.md). Name the files to change and how to verify. Do not edit source files.",
    },
    RoleSpec {
        name: "worker",
        description: "Implements a scoped change: edits files and runs commands/tests",
        model: DEFAULT_MODEL,
        thinking: "medium",
        tools: &["read", "bash", "edit", "write", "grep", "find", "ls"],
        instructions: "You are a worker. Implement exactly the task you were given, touching only the files it needs. Run the relevant tests or checks before reporting. Report what changed and how you verified it.",
    },
    RoleSpec {
        name: "reviewer",
        description: "Read-only review of a change or files; reports concrete findings",
        model: "zai/glm-5.3-flash",
        thinking: "high",
        tools: &["read", "grep", "find", "ls", "bash"],
        instructions: "You are a reviewer. Review only what the task names (use git diff/log via bash to see changes). Read-only: never edit files. Report concrete findings ranked by severity, each with file:line and why it is wrong; say plainly if you found nothing.",
    },
    RoleSpec {
        name: "scout",
        description: "Fast read-only lookup: finds files, symbols, and answers questions about code",
        model: DEFAULT_MODEL,
        thinking: "low",
        tools: &["read", "grep", "find", "ls"],
        instructions: "You are a scout. Answer the question in the task quickly by reading code. Read-only. Report file paths and short excerpts, not essays.",
    },
];

fn footer(report_tool: &str) -> String {
    [
        "You are a subagent started by a parent agent through herdr. Messages wrapped in <hc from=...> come from that parent.".to_string(),
        format!("Report with the {report_tool} tool (not hc send) when you are done or stuck; one report with the result, or a question if blocked. Write long results to a file and report its path."),
        "Stay within the task's scope. Do not start other agents.".to_string(),
    ]
    .join("\n")
}

pub fn templates_dir_from(xdg: Option<&str>, home: &Path) -> PathBuf {
    let base = match xdg {
        Some(x) if !x.is_empty() => PathBuf::from(x),
        _ => home.join(".config"),
    };
    base.join("herdr-core").join("templates")
}

pub fn templates_dir() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    templates_dir_from(std::env::var("XDG_CONFIG_HOME").ok().as_deref(), &home)
}

pub fn role_command(role: &RoleSpec) -> String {
    let tools = [role.tools, &[REPORT_TOOL_QUALIFIED]].concat().join(",");
    format!("{ROLE_ENV}={} {PI_BIN} --model {} --thinking {} --tools {tools}", role.name, role.model, role.thinking)
}

fn frontmatter(role: &RoleSpec, command: &str, footer: &str) -> String {
    [
        "---",
        &format!("name: {}", role.name),
        &format!("description: {}", role.description),
        &format!("command: {command}"),
        "---",
        role.instructions,
        "",
        footer,
        "",
    ]
    .join("\n")
}

pub fn render_template(role: &RoleSpec) -> String {
    frontmatter(role, &role_command(role), &footer(REPORT_TOOL_QUALIFIED))
}

/// What the old pi extension wrote; used to tell untouched files from user edits.
pub fn legacy_render_template(role: &RoleSpec) -> String {
    let tools = [role.tools, &[REPORT_TOOL]].concat().join(",");
    let cmd = format!(
        "{PI_BIN} --model {} --thinking {} --tools {tools} {LEGACY_ROLE_FLAG} {}",
        role.model, role.thinking, role.name
    );
    frontmatter(role, &cmd, &footer(REPORT_TOOL))
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct WriteReport {
    pub written: Vec<String>,
    pub skipped: Vec<String>,
}

/// Write default role templates that are missing; never overwrites.
pub fn write_default_templates(dir: &Path, roles: &[RoleSpec]) -> std::io::Result<WriteReport> {
    std::fs::create_dir_all(dir)?;
    let mut report = WriteReport::default();
    for role in roles {
        let file = dir.join(format!("{}.md", role.name));
        match OpenOptions::new().write(true).create_new(true).open(&file) {
            Ok(mut f) => {
                f.write_all(render_template(role).as_bytes())?;
                report.written.push(role.name.into());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => report.skipped.push(role.name.into()),
            Err(e) => return Err(e),
        }
    }
    Ok(report)
}

#[derive(Debug, PartialEq, Eq)]
pub enum MigrateAction {
    /// File matches what the old extension wrote: safe to rewrite.
    Rewrite,
    /// Already in the new shape.
    Current,
    /// Differs from both: the user edited it.
    Edited,
}

pub fn classify_template(role: &RoleSpec, content: &str) -> MigrateAction {
    if content == render_template(role) {
        MigrateAction::Current
    } else if content == legacy_render_template(role) {
        MigrateAction::Rewrite
    } else {
        MigrateAction::Edited
    }
}

pub fn is_role_command(command: &str) -> bool {
    command.contains(&format!("{ROLE_ENV}=")) || command.contains(LEGACY_ROLE_FLAG)
}

/// Role templates are the ones whose command launches a pi subagent.
pub fn role_templates(data: &Value) -> Vec<TemplateInfo> {
    let Some(list) = data.get("templates").and_then(Value::as_array) else { return vec![] };
    list.iter()
        .filter_map(|t| {
            let name = t.get("name")?.as_str()?;
            let command = t.get("command")?.as_str()?;
            if !is_role_command(command) {
                return None;
            }
            Some(TemplateInfo {
                name: name.into(),
                description: t.get("description").and_then(Value::as_str).unwrap_or("").into(),
                command: command.into(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn role(name: &str) -> &'static RoleSpec {
        DEFAULT_ROLES.iter().find(|r| r.name == name).unwrap()
    }

    #[test]
    fn models_are_provider_id_reviewer_differs() {
        for r in DEFAULT_ROLES {
            let (p, id) = r.model.split_once('/').expect(r.name);
            assert!(!p.is_empty() && !id.is_empty() && !r.model.contains(' '), "{}", r.name);
        }
        assert_eq!(role("reviewer").model, "zai/glm-5.3-flash");
        assert_eq!(role("worker").model, "opencode-go/deepseek-v4.1-flash");
    }

    #[test]
    fn command_sets_env_and_allowlists_report_tool() {
        let cmd = role_command(role("scout"));
        assert!(cmd.starts_with("HC_SUBAGENT_ROLE=scout /opt/homebrew/bin/pi "), "{cmd}");
        assert!(cmd.ends_with("--tools read,grep,find,ls,mcp__herdr__subagent_report"), "{cmd}");
        assert!(!cmd.contains("--subagent-role"));
        assert!(!cmd.contains("subagent_spawn"));
        assert!(role_command(role("reviewer")).contains("--model zai/glm-5.3-flash "));
    }

    #[test]
    fn read_only_roles_cannot_edit() {
        for name in ["scout", "reviewer", "planner"] {
            assert!(!role(name).tools.contains(&"edit"), "{name}");
        }
    }

    #[test]
    fn template_has_frontmatter_and_footer() {
        let t = render_template(&DEFAULT_ROLES[0]);
        assert!(t.starts_with("---\nname: planner\ndescription: "));
        assert!(t.contains("\ncommand: HC_SUBAGENT_ROLE=planner "));
        assert!(t.contains("Report with the mcp__herdr__subagent_report tool (not hc send)"));
        assert!(t.contains("Do not start other agents"));
    }

    #[test]
    fn writes_missing_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("worker.md"), "mine").unwrap();
        let r = write_default_templates(dir.path(), DEFAULT_ROLES).unwrap();
        assert_eq!(r.skipped, vec!["worker"]);
        let mut w = r.written.clone();
        w.sort();
        assert_eq!(w, vec!["planner", "reviewer", "scout"]);
        assert_eq!(std::fs::read_to_string(dir.path().join("worker.md")).unwrap(), "mine");
        assert!(write_default_templates(dir.path(), DEFAULT_ROLES).unwrap().written.is_empty());
    }

    #[test]
    fn templates_dir_honours_xdg() {
        assert_eq!(templates_dir_from(Some("/x"), Path::new("/h")), PathBuf::from("/x/herdr-core/templates"));
        assert_eq!(templates_dir_from(None, Path::new("/h")), PathBuf::from("/h/.config/herdr-core/templates"));
    }

    #[test]
    fn role_templates_keeps_new_and_legacy() {
        let roles = role_templates(&json!({"templates":[
            {"name":"scout","description":"d","command":"/opt/homebrew/bin/pi --subagent-role scout"},
            {"name":"worker","description":"w","command":"HC_SUBAGENT_ROLE=worker /opt/homebrew/bin/pi"},
            {"name":"claude-fix","description":"x","command":"claude"},
            {"name":3}
        ]}));
        assert_eq!(roles.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), vec!["scout", "worker"]);
        assert!(role_templates(&json!({})).is_empty());
        assert!(role_templates(&Value::Null).is_empty());
    }

    #[test]
    fn legacy_matches_old_extension_output() {
        // Byte-for-byte what the extension wrote to ~/.config/herdr-core/templates/scout.md
        let old = "---\nname: scout\ndescription: Fast read-only lookup: finds files, symbols, and answers questions about code\ncommand: /opt/homebrew/bin/pi --model opencode-go/deepseek-v4.1-flash --thinking low --tools read,grep,find,ls,subagent_report --subagent-role scout\n---\nYou are a scout. Answer the question in the task quickly by reading code. Read-only. Report file paths and short excerpts, not essays.\n\nYou are a subagent started by a parent agent through herdr. Messages wrapped in <hc from=...> come from that parent.\nReport with the subagent_report tool (not hc send) when you are done or stuck; one report with the result, or a question if blocked. Write long results to a file and report its path.\nStay within the task's scope. Do not start other agents.\n";
        let scout = role("scout");
        assert_eq!(legacy_render_template(scout), old);
        assert_eq!(classify_template(scout, old), MigrateAction::Rewrite);
        assert_eq!(classify_template(scout, &render_template(scout)), MigrateAction::Current);
        assert_eq!(classify_template(scout, "mine"), MigrateAction::Edited);
    }
}
