//! Parse every JSONL session entry under ~/.sam/sessions and report coverage.
//! Usage: cargo run -p sam-protocol --example parse_sessions [dir]

use sam_protocol::session::{parse_entry, SessionEntry};
use std::collections::BTreeMap;
use std::path::PathBuf;

fn main() {
    let dir = std::env::args().nth(1).map(PathBuf::from).unwrap_or_else(|| {
        let home = std::env::var("HOME").expect("HOME not set");
        PathBuf::from(home).join(".sam/sessions")
    });

    let mut files = Vec::new();
    collect_jsonl(&dir, &mut files);
    files.sort();

    let mut total = 0usize;
    let mut unknown = 0usize;
    let mut json_errors = 0usize;
    let mut by_type: BTreeMap<String, usize> = BTreeMap::new();
    let mut unknown_samples: Vec<(PathBuf, String)> = Vec::new();

    for file in &files {
        let Ok(content) = std::fs::read_to_string(file) else {
            continue;
        };
        for (i, line) in content.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let value: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(e) => {
                    json_errors += 1;
                    eprintln!("JSON error {}:{}: {}", file.display(), i + 1, e);
                    continue;
                }
            };
            let type_tag = value
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("<none>")
                .to_string();
            // First line of each file is the session header, not an entry.
            if type_tag == "session" {
                continue;
            }
            total += 1;
            let key = if type_tag == "message" {
                let role = value
                    .pointer("/message/role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("<none>");
                format!("message/{role}")
            } else {
                type_tag.clone()
            };
            *by_type.entry(key).or_default() += 1;
            if matches!(parse_entry(value), SessionEntry::Unknown { .. }) {
                unknown += 1;
                if unknown_samples.len() < 10 {
                    unknown_samples.push((file.clone(), line.chars().take(400).collect()));
                }
            }
        }
    }

    println!("files: {}", files.len());
    println!("entries: {total}, unknown: {unknown}, json errors: {json_errors}");
    println!("\nentry types:");
    for (t, n) in &by_type {
        println!("  {t}: {n}");
    }
    if !unknown_samples.is_empty() {
        println!("\nunknown samples:");
        for (file, sample) in &unknown_samples {
            println!("  {}:\n    {}", file.display(), sample);
        }
    }
    if unknown > 0 || json_errors > 0 {
        std::process::exit(1);
    }
}

fn collect_jsonl(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl(&path, out);
        } else if path.extension().is_some_and(|e| e == "jsonl") {
            out.push(path);
        }
    }
}
