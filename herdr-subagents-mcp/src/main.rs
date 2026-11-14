//! herdr-subagents-mcp — spawn and talk to pi subagents through herdr's `hc`,
//! as one stdio MCP server shared by pi and Claude Code.
//!
//!   herdr-subagents-mcp                 serve MCP on stdio
//!   herdr-subagents-mcp init            write missing role templates (never overwrites)
//!   herdr-subagents-mcp migrate [--force ROLE]...
//!                                       rewrite templates written by the old pi extension

mod format;
mod hc;
mod placement;
mod roles;
mod server;

use std::process::ExitCode;

use rmcp::ServiceExt;

use crate::roles::{
    DEFAULT_ROLES, MigrateAction, classify_template, render_template, templates_dir, write_default_templates,
};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None => serve(),
        Some("init") => init(),
        Some("migrate") => migrate(&args[1..]),
        Some("-h" | "--help" | "help") => {
            println!(
                "usage: herdr-subagents-mcp [init | migrate [--force ROLE]...]\nWith no arguments, serves MCP on stdio."
            );
            ExitCode::SUCCESS
        }
        Some(other) => {
            eprintln!("unknown command: {other} (try --help)");
            ExitCode::from(2)
        }
    }
}

fn serve() -> ExitCode {
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    let r: anyhow::Result<()> = rt.block_on(async {
        let mode = server::Mode::from_env();
        let handler = server::Herdr::new(mode).await;
        let running = handler.serve(rmcp::transport::stdio()).await?;
        running.waiting().await?;
        Ok(())
    });
    match r {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("herdr-subagents-mcp: {e:#}");
            ExitCode::FAILURE
        }
    }
}

fn init() -> ExitCode {
    let dir = templates_dir();
    match write_default_templates(&dir, DEFAULT_ROLES) {
        Ok(r) => {
            println!("Templates in {}", dir.display());
            println!("written: {}", if r.written.is_empty() { "none".into() } else { r.written.join(", ") });
            println!("kept existing: {}", if r.skipped.is_empty() { "none".into() } else { r.skipped.join(", ") });
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("init failed: {e}");
            ExitCode::FAILURE
        }
    }
}

fn migrate(rest: &[String]) -> ExitCode {
    let mut force: Vec<&str> = Vec::new();
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        match (a.as_str(), it.next()) {
            ("--force", Some(role)) => force.push(role),
            _ => {
                eprintln!("usage: herdr-subagents-mcp migrate [--force ROLE]...");
                return ExitCode::from(2);
            }
        }
    }
    let dir = templates_dir();
    let mut failed = false;
    for role in DEFAULT_ROLES {
        let file = dir.join(format!("{}.md", role.name));
        let Ok(content) = std::fs::read_to_string(&file) else {
            println!("{}: missing (run init to create it)", role.name);
            continue;
        };
        let forced = force.contains(&role.name);
        match classify_template(role, &content) {
            MigrateAction::Current => println!("{}: already current", role.name),
            MigrateAction::Edited if !forced => {
                println!("{}: edited by you; not touched. Diff to the new template:", role.name);
                show_diff(&file, &render_template(role));
                println!("  rerun with --force {} to replace it", role.name);
            }
            MigrateAction::Rewrite | MigrateAction::Edited => match std::fs::write(&file, render_template(role)) {
                Ok(()) => println!("{}: rewritten", role.name),
                Err(e) => {
                    eprintln!("{}: write failed: {e}", role.name);
                    failed = true;
                }
            },
        }
    }
    if failed { ExitCode::FAILURE } else { ExitCode::SUCCESS }
}

fn show_diff(file: &std::path::Path, new: &str) {
    let tmp = std::env::temp_dir().join(format!("herdr-template-{}.md", std::process::id()));
    if std::fs::write(&tmp, new).is_ok() {
        let _ = std::process::Command::new("diff").arg("-u").arg(file).arg(&tmp).status();
        let _ = std::fs::remove_file(&tmp);
    }
}
