//! Right sidebar: three collapsible sections over the active session —
//! artifacts list, working-directory file tree (with @file insert and
//! drop-to-cwd), and session stats. Port of the Tauri `RightSidebar`
//! (`ArtifactsSection` + `ContextSection` + `SessionStatsSection`).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use chrono::DateTime;
use gpui::{div, prelude::*, px, Context, Entity, ExternalPaths, SharedString, Window};
use gpui_component::{ActiveTheme, Icon, IconName, Sizable, StyledExt};
use sam_protocol::{
    session::{AgentMessage, ContentItem, SessionEntry},
    SessionInfoDto,
};

use crate::state::sessions::{SessionStore, ToolResultInfo};
use crate::views::composer::ComposerInputGlobal;

#[derive(Clone, Copy)]
enum Section {
    Artifacts,
    Files,
    Stats,
}

struct ArtifactRow {
    path: String,
    title: String,
    type_: String,
}

#[derive(Default)]
struct Stats {
    date: Option<String>,
    session_id: String,
    models: Vec<String>,
    user_messages: u32,
    assistant_messages: u32,
    tool_calls: u32,
    tokens_in: f64,
    tokens_out: f64,
    tokens_cache: f64,
    cost: f64,
}

struct DirEntry {
    name: String,
    is_dir: bool,
}

pub struct RightSidebar {
    store: Entity<SessionStore>,
    artifacts_open: bool,
    files_open: bool,
    stats_open: bool,
    /// Working dir of the active session; the file tree resets when it changes.
    cwd: Option<PathBuf>,
    expanded: HashSet<PathBuf>,
    children: HashMap<PathBuf, Vec<DirEntry>>,
    drop_status: Option<String>,
}

impl RightSidebar {
    pub fn new(store: Entity<SessionStore>, cx: &mut Context<Self>) -> Self {
        cx.observe(&store, |_, _, cx| cx.notify()).detach();
        Self {
            store,
            artifacts_open: true,
            files_open: true,
            stats_open: true,
            cwd: None,
            expanded: HashSet::new(),
            children: HashMap::new(),
            drop_status: None,
        }
    }

    fn toggle_section(&mut self, section: Section, cx: &mut Context<Self>) {
        match section {
            Section::Artifacts => self.artifacts_open = !self.artifacts_open,
            Section::Files => self.files_open = !self.files_open,
            Section::Stats => self.stats_open = !self.stats_open,
        }
        cx.notify();
    }

    /// Read + cache a directory's (non-hidden) entries, dirs first then a-z.
    fn ensure_dir_loaded(&mut self, dir: &Path) {
        if self.children.contains_key(dir) {
            return;
        }
        let mut entries: Vec<DirEntry> = match std::fs::read_dir(dir) {
            Ok(rd) => rd
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') {
                        return None;
                    }
                    let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                    Some(DirEntry { name, is_dir })
                })
                .collect(),
            Err(_) => Vec::new(),
        };
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        self.children.insert(dir.to_path_buf(), entries);
    }

    fn toggle_dir(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        if !self.expanded.remove(&path) {
            self.ensure_dir_loaded(&path);
            self.expanded.insert(path);
        }
        cx.notify();
    }

    /// Flatten the expanded tree into (path, name, is_dir, depth) rows.
    fn flatten_tree(&self) -> Vec<(PathBuf, String, bool, usize)> {
        let mut out = Vec::new();
        if let Some(root) = self.cwd.clone() {
            self.walk(&root, 0, &mut out);
        }
        out
    }

    fn walk(&self, dir: &Path, depth: usize, out: &mut Vec<(PathBuf, String, bool, usize)>) {
        if let Some(entries) = self.children.get(dir) {
            for e in entries {
                let path = dir.join(&e.name);
                out.push((path.clone(), e.name.clone(), e.is_dir, depth));
                if e.is_dir && self.expanded.contains(&path) {
                    self.walk(&path, depth + 1, out);
                }
            }
        }
    }

    fn drop_to_cwd(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        let Some(cwd) = self.cwd.clone() else {
            return;
        };
        let mut n = 0;
        for src in paths {
            if let Some(name) = src.file_name() {
                if std::fs::copy(&src, cwd.join(name)).is_ok() {
                    n += 1;
                }
            }
        }
        self.drop_status = Some(match n {
            0 => "Couldn't copy files".to_string(),
            1 => "1 file added".to_string(),
            _ => format!("{n} files added"),
        });
        // Invalidate the root listing so the new files show on next render.
        self.children.remove(&cwd);
        cx.notify();
    }

    fn section_header(
        &self,
        id: &'static str,
        title: String,
        open: bool,
        section: Section,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        div()
            .id(id)
            .h_flex()
            .items_center()
            .gap_1()
            .py_1()
            .cursor_pointer()
            .text_sm()
            .font_semibold()
            .child(
                Icon::new(if open {
                    IconName::ChevronDown
                } else {
                    IconName::ChevronRight
                })
                .xsmall()
                .text_color(cx.theme().muted_foreground),
            )
            .child(title)
            .on_click(cx.listener(move |this, _, _, cx| this.toggle_section(section, cx)))
    }

    fn stat_row(&self, label: &'static str, value: String, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .h_flex()
            .justify_between()
            .gap_2()
            .text_xs()
            .child(
                div()
                    .flex_none()
                    .text_color(cx.theme().muted_foreground)
                    .child(label),
            )
            .child(div().flex_1().text_right().truncate().child(value))
    }
}

fn basename(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| p.to_string_lossy().to_string())
}

fn type_icon(t: &str) -> IconName {
    match t {
        "html" => IconName::Globe,
        "image" => IconName::Frame,
        _ => IconName::File,
    }
}

fn format_tokens(n: f64) -> String {
    if n >= 1_000_000.0 {
        format!("{:.1}M", n / 1_000_000.0)
    } else if n >= 1_000.0 {
        format!("{:.1}k", n / 1_000.0)
    } else {
        format!("{}", n as u64)
    }
}

/// report_artifact tool calls with a successful result, deduped by path
/// (keeping the latest). Reads path/title/type from the toolResult details,
/// matching the Tauri ArtifactsSection.
fn collect_artifacts(
    entries: &[SessionEntry],
    tool_results: &HashMap<String, ToolResultInfo>,
) -> Vec<ArtifactRow> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<ArtifactRow> = Vec::new();
    for entry in entries {
        let SessionEntry::Message {
            message: AgentMessage::Assistant { content, .. },
            ..
        } = entry
        else {
            continue;
        };
        for item in content {
            let ContentItem::ToolCall { id, name, .. } = item else {
                continue;
            };
            if name != "report_artifact" {
                continue;
            }
            let Some(result) = tool_results.get(id) else {
                continue;
            };
            if result.is_error {
                continue;
            }
            let Some(details) = &result.details else {
                continue;
            };
            let Some(path) = details.get("path").and_then(|v| v.as_str()) else {
                continue;
            };
            let title = details
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or(path)
                .to_string();
            let type_ = details
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let row = ArtifactRow {
                path: path.to_string(),
                title,
                type_,
            };
            if let Some(&ix) = seen.get(path) {
                out[ix] = row;
            } else {
                seen.insert(path.to_string(), out.len());
                out.push(row);
            }
        }
    }
    out
}

fn compute_stats(info: &SessionInfoDto, entries: &[SessionEntry]) -> Stats {
    let mut stats = Stats {
        session_id: info.id.clone(),
        date: DateTime::parse_from_rfc3339(&info.created)
            .ok()
            .map(|d| d.format("%b %d, %Y").to_string()),
        ..Default::default()
    };
    let mut models: Vec<String> = Vec::new();
    for entry in entries {
        let SessionEntry::Message { message, .. } = entry else {
            continue;
        };
        match message {
            AgentMessage::User { .. } => stats.user_messages += 1,
            AgentMessage::Assistant {
                content,
                model,
                provider,
                usage,
                ..
            } => {
                stats.assistant_messages += 1;
                if !model.is_empty() {
                    let label = if provider.is_empty() {
                        model.clone()
                    } else {
                        format!("{provider}/{model}")
                    };
                    if !models.contains(&label) {
                        models.push(label);
                    }
                }
                stats.tokens_in += usage.input;
                stats.tokens_out += usage.output;
                stats.tokens_cache += usage.cache_read;
                stats.cost += usage.cost.total;
                stats.tool_calls += content
                    .iter()
                    .filter(|c| matches!(c, ContentItem::ToolCall { .. }))
                    .count() as u32;
            }
            _ => {}
        }
    }
    stats.models = models;
    stats
}

impl Render for RightSidebar {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Snapshot from the store, then drop its borrow before mutating self.
        let (active_cwd, cwd_label, artifacts, stats) = {
            let store = self.store.read(cx);
            let active = store.active.as_ref();
            let cwd = active
                .map(|a| a.info.cwd.clone())
                .filter(|c| !c.is_empty())
                .map(PathBuf::from);
            let label = cwd.as_ref().map(|p| basename(p));
            let artifacts = active
                .map(|a| collect_artifacts(&a.entries, &a.tool_results))
                .unwrap_or_default();
            let stats = active.map(|a| compute_stats(&a.info, &a.entries));
            (cwd, label, artifacts, stats)
        };

        // Reset the file tree when the active session's working dir changes.
        if active_cwd != self.cwd {
            self.cwd = active_cwd;
            self.expanded.clear();
            self.children.clear();
            self.drop_status = None;
        }
        if let Some(root) = self.cwd.clone() {
            self.ensure_dir_loaded(&root);
        }
        let tree_rows = self.flatten_tree();
        let root = self.cwd.clone();

        // --- Artifacts section ---
        let artifacts_title = if artifacts.is_empty() {
            "Artifacts".to_string()
        } else {
            format!("Artifacts ({})", artifacts.len())
        };
        let mut artifacts_body = div().v_flex().gap_0p5().pb_1();
        if artifacts.is_empty() {
            artifacts_body = artifacts_body.child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .py_1()
                    .child("Artifacts from this session will appear here."),
            );
        } else {
            for a in &artifacts {
                let path = a.path.clone();
                artifacts_body = artifacts_body.child(
                    div()
                        .id(SharedString::from(format!("artifact-{}", a.path)))
                        .h_flex()
                        .items_center()
                        .gap_2()
                        .px_2()
                        .py_1()
                        .rounded_md()
                        .cursor_pointer()
                        .hover(|this| this.bg(cx.theme().list_hover))
                        .child(
                            Icon::new(type_icon(&a.type_))
                                .small()
                                .text_color(cx.theme().muted_foreground),
                        )
                        .child(div().flex_1().text_sm().truncate().child(a.title.clone()))
                        .on_click(move |_, _, cx| {
                            crate::state::ui::open_artifact(path.clone(), cx);
                        }),
                );
            }
        }

        // --- Files section ---
        let mut files_body = div().v_flex().gap_0().pb_1();
        if root.is_none() {
            files_body = files_body.child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .py_1()
                    .child("No working directory set"),
            );
        } else {
            if tree_rows.is_empty() {
                files_body = files_body.child(
                    div()
                        .text_xs()
                        .text_color(cx.theme().muted_foreground)
                        .py_1()
                        .child("Empty directory"),
                );
            }
            for (path, name, is_dir, depth) in tree_rows {
                let indent = px(depth as f32 * 14. + 4.);
                let expanded = self.expanded.contains(&path);
                let mut row = div()
                    .id(SharedString::from(format!("tree-{}", path.display())))
                    .h_flex()
                    .items_center()
                    .gap_1()
                    .pl(indent)
                    .pr_1()
                    .py_0p5()
                    .rounded_md()
                    .cursor_pointer()
                    .text_sm()
                    .hover(|this| this.bg(cx.theme().list_hover));
                if is_dir {
                    row = row
                        .child(
                            Icon::new(if expanded {
                                IconName::ChevronDown
                            } else {
                                IconName::ChevronRight
                            })
                            .xsmall()
                            .text_color(cx.theme().muted_foreground),
                        )
                        .child(
                            Icon::new(if expanded {
                                IconName::FolderOpen
                            } else {
                                IconName::Folder
                            })
                            .xsmall()
                            .text_color(cx.theme().muted_foreground),
                        )
                        .child(div().truncate().child(name))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.toggle_dir(path.clone(), cx)
                        }));
                } else {
                    // File: clicking inserts an @relative-path ref into the composer.
                    let rel = root
                        .as_ref()
                        .and_then(|r| path.strip_prefix(r).ok())
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string();
                    row = row
                        .child(div().w(px(12.)))
                        .child(
                            Icon::new(IconName::File)
                                .xsmall()
                                .text_color(cx.theme().muted_foreground),
                        )
                        .child(div().truncate().child(name))
                        .on_click(move |_, window: &mut Window, cx: &mut gpui::App| {
                            if let Some(input) =
                                cx.try_global::<ComposerInputGlobal>().map(|g| g.0.clone())
                            {
                                input.update(cx, |input, cx| {
                                    input.insert(format!("@{rel} "), window, cx);
                                    input.focus(window, cx);
                                });
                            }
                        });
                }
                files_body = files_body.child(row);
            }
            // Drop-to-cwd zone (port of FileDropzone).
            let drop_label = self
                .drop_status
                .clone()
                .unwrap_or_else(|| "Drop files here".to_string());
            files_body = files_body.child(
                div()
                    .id("cwd-dropzone")
                    .mt_2()
                    .p_2()
                    .rounded_md()
                    .border_1()
                    .border_dashed()
                    .border_color(cx.theme().border)
                    .h_flex()
                    .items_center()
                    .justify_center()
                    .gap_1()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child(Icon::new(IconName::Inbox).xsmall())
                    .child(drop_label)
                    .on_drop(cx.listener(|this, paths: &ExternalPaths, _, cx| {
                        this.drop_to_cwd(paths.paths().to_vec(), cx);
                    })),
            );
        }

        // --- Session stats section ---
        let mut stats_body = div().v_flex().gap_0p5().pb_1();
        if let Some(s) = &stats {
            let mut token_parts: Vec<String> = Vec::new();
            if s.tokens_in > 0. {
                token_parts.push(format!("{} in", format_tokens(s.tokens_in)));
            }
            if s.tokens_out > 0. {
                token_parts.push(format!("{} out", format_tokens(s.tokens_out)));
            }
            if s.tokens_cache > 0. {
                token_parts.push(format!("{} cache", format_tokens(s.tokens_cache)));
            }
            let total_messages = s.user_messages + s.assistant_messages;
            if !s.session_id.is_empty() {
                stats_body = stats_body.child(self.stat_row("Session", s.session_id.clone(), cx));
            }
            if let Some(date) = &s.date {
                stats_body = stats_body.child(self.stat_row("Date", date.clone(), cx));
            }
            if !s.models.is_empty() {
                stats_body = stats_body.child(self.stat_row("Model", s.models.join(", "), cx));
            }
            stats_body = stats_body.child(self.stat_row(
                "Messages",
                format!(
                    "{total_messages} ({} user, {} asst)",
                    s.user_messages, s.assistant_messages
                ),
                cx,
            ));
            stats_body =
                stats_body.child(self.stat_row("Tool calls", s.tool_calls.to_string(), cx));
            if !token_parts.is_empty() {
                stats_body = stats_body.child(self.stat_row("Tokens", token_parts.join(", "), cx));
            }
            stats_body = stats_body.child(self.stat_row("Cost", format!("${:.3}", s.cost), cx));
        } else {
            stats_body = stats_body.child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .py_1()
                    .child("No active session"),
            );
        }

        div()
            .id("right-sidebar-scroll")
            .h_full()
            .w(px(288.))
            .flex_none()
            .overflow_y_scroll()
            .bg(cx.theme().sidebar)
            .text_color(cx.theme().sidebar_foreground)
            .border_l_1()
            .border_color(cx.theme().sidebar_border)
            .v_flex()
            .child(
                // Header: working-directory basename.
                div()
                    .w_full()
                    .px_3()
                    .py_2()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .h_flex()
                    .items_center()
                    .gap_1p5()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .when_some(cwd_label, |this, label| {
                        this.child(Icon::new(IconName::Folder).xsmall())
                            .child(div().truncate().child(label))
                    }),
            )
            .child(
                div()
                    .v_flex()
                    .gap_2()
                    .px_3()
                    .py_3()
                    .child(self.section_header(
                        "sec-artifacts",
                        artifacts_title,
                        self.artifacts_open,
                        Section::Artifacts,
                        cx,
                    ))
                    .when(self.artifacts_open, |this| this.child(artifacts_body))
                    .child(self.section_header(
                        "sec-files",
                        "Files".to_string(),
                        self.files_open,
                        Section::Files,
                        cx,
                    ))
                    .when(self.files_open, |this| this.child(files_body))
                    .child(self.section_header(
                        "sec-stats",
                        "Session Stats".to_string(),
                        self.stats_open,
                        Section::Stats,
                        cx,
                    ))
                    .when(self.stats_open, |this| this.child(stats_body)),
            )
    }
}
