//! Session entry renderers — port of `SessionEntryRenderer.tsx` →
//! `MessageEntryView.tsx` dispatch. Pure functions: state for collapsibles
//! lives in window-keyed state, keyed by entry id.

use std::collections::HashMap;

use gpui::{div, prelude::*, px, AnyElement, App, Div, SharedString, Window};
use gpui_component::{ActiveTheme, Icon, IconName, Sizable, StyledExt};
use sam_protocol::session::{AgentMessage, ContentItem, MessageContent, SessionEntry};

use crate::markdown::md;
use crate::state::sessions::{StreamItem, ToolResultInfo, ToolStatus};

/// Live row for the in-progress turn (port of `StreamingTurnView.tsx`).
pub fn render_streaming(items: &[StreamItem], window: &mut Window, cx: &mut App) -> AnyElement {
    let mut column = div().w_full().v_flex().gap_2();

    for (i, item) in items.iter().enumerate() {
        match item {
            StreamItem::Text(text) => {
                column = column.child(md(
                    SharedString::from(format!("stream-text-{i}")),
                    text.clone(),
                    window,
                    cx,
                ));
            }
            StreamItem::Thinking { content, complete } => {
                if *complete {
                    column = column.child(collapsible_card(
                        format!("stream-think-{i}"),
                        IconName::Bot,
                        "Thinking".into(),
                        format!("{} chars", content.len()),
                        content.clone(),
                        false,
                        window,
                        cx,
                    ));
                } else {
                    // Live thinking: show the tail inline, italic + muted.
                    let tail: String = content
                        .chars()
                        .rev()
                        .take(280)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect();
                    column = column.child(
                        div()
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .border_1()
                            .border_color(cx.theme().border)
                            .text_sm()
                            .italic()
                            .text_color(cx.theme().muted_foreground)
                            .child(format!("Thinking… {tail}")),
                    );
                }
            }
            StreamItem::Tool {
                id,
                name,
                status,
                args,
                result,
                details,
            } => {
                // Completed calls of known tools get their special card
                // (search results, artifact link, …) instead of the generic
                // one — port of the dispatch in StreamingTurnView.tsx.
                if !matches!(status, ToolStatus::Running) {
                    if let Some(card) = crate::views::tool_cards::render_special(
                        id,
                        name,
                        args,
                        result.as_deref(),
                        details.as_ref(),
                        window,
                        cx,
                    ) {
                        column = column.child(card);
                        continue;
                    }
                }
                let (icon, color) = match status {
                    ToolStatus::Running => (IconName::LoaderCircle, cx.theme().muted_foreground),
                    ToolStatus::Done => (IconName::Check, cx.theme().success),
                    ToolStatus::Error => (IconName::TriangleAlert, cx.theme().danger),
                };
                let summary = summarize_args(name, args);
                let mut card = div()
                    .w_full()
                    .px_3()
                    .py_1p5()
                    .rounded_md()
                    .border_1()
                    .border_color(cx.theme().border)
                    .v_flex()
                    .gap_1()
                    .child(
                        div()
                            .h_flex()
                            .gap_2()
                            .text_sm()
                            .child(Icon::new(icon).small().text_color(color))
                            .child(div().font_semibold().child(name.clone()))
                            .child(
                                div()
                                    .flex_1()
                                    .truncate()
                                    .text_color(cx.theme().muted_foreground)
                                    .child(summary),
                            ),
                    );
                if matches!(status, ToolStatus::Running) {
                    if let Some(partial) = result {
                        card = card.child(
                            div()
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .truncate()
                                .child(truncate(partial, 200)),
                        );
                    }
                }
                let _ = id;
                column = column.child(card);
            }
        }
    }

    // Typing indicator while waiting for the next event.
    column = column.child(
        div()
            .px_1()
            .text_color(cx.theme().muted_foreground)
            .child("●"),
    );

    row(column.into_any_element()).into_any_element()
}

/// The just-sent user message, shown until the JSONL refresh includes it.
pub fn render_pending_user(text: &str, window: &mut Window, cx: &mut App) -> AnyElement {
    render_user(
        "pending-user",
        &MessageContent::Text(text.to_string()),
        window,
        cx,
    )
}

pub fn render_entry(
    entry: &SessionEntry,
    tool_results: &HashMap<String, ToolResultInfo>,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    match entry {
        SessionEntry::Message { id, message, .. } => {
            render_message(id, message, tool_results, window, cx)
        }
        SessionEntry::Compaction { summary, .. } => {
            divider("Conversation compacted", Some(summary.clone()), cx).into_any_element()
        }
        SessionEntry::BranchSummary { summary, .. } => {
            divider("Branched", Some(summary.clone()), cx).into_any_element()
        }
        SessionEntry::ModelChange { model_id, .. } => {
            system_line(format!("model → {model_id}"), cx).into_any_element()
        }
        SessionEntry::ThinkingLevelChange { thinking_level, .. } => {
            system_line(format!("thinking → {thinking_level}"), cx).into_any_element()
        }
        SessionEntry::CustomMessage { id, content, .. } => row(md(
            SharedString::from(format!("md-{id}")),
            content.plain_text(),
            window,
            cx,
        )
        .into_any_element())
        .into_any_element(),
        SessionEntry::Unknown { raw } => system_line(
            format!(
                "unsupported entry ({})",
                raw.get("type").and_then(|t| t.as_str()).unwrap_or("?")
            ),
            cx,
        )
        .into_any_element(),
        // Filtered out by display_indices; render nothing defensively.
        _ => div().into_any_element(),
    }
}

fn render_message(
    id: &str,
    message: &AgentMessage,
    tool_results: &HashMap<String, ToolResultInfo>,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    match message {
        AgentMessage::User { content, .. } => render_user(id, content, window, cx),
        AgentMessage::Assistant {
            content,
            error_message,
            ..
        } => render_assistant(
            id,
            content,
            error_message.as_deref(),
            tool_results,
            window,
            cx,
        ),
        // Rendered inline at the assistant's tool-call row; filtered from
        // display_indices, so this only runs defensively.
        AgentMessage::ToolResult { .. } => div().into_any_element(),
        AgentMessage::BashExecution {
            command,
            output,
            exit_code,
            cancelled,
            ..
        } => render_bash(id, command, output, *exit_code, *cancelled, window, cx),
        AgentMessage::Custom { content, .. } => row(md(
            SharedString::from(format!("md-{id}")),
            content.plain_text(),
            window,
            cx,
        )
        .into_any_element())
        .into_any_element(),
        AgentMessage::CompactionSummary { summary, .. } => {
            divider("Conversation compacted", Some(summary.clone()), cx).into_any_element()
        }
        AgentMessage::BranchSummary { summary, .. } => {
            divider("Branched", Some(summary.clone()), cx).into_any_element()
        }
    }
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

fn render_user(
    id: &str,
    content: &MessageContent,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let text = content.plain_text();
    let (images, audio_urls) = match content {
        MessageContent::Items(items) => (
            items
                .iter()
                .filter(|i| matches!(i, ContentItem::Image { .. }))
                .cloned()
                .collect::<Vec<_>>(),
            items
                .iter()
                .filter_map(|i| match i {
                    ContentItem::AudioRef { url } => Some(url.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>(),
        ),
        _ => (Vec::new(), Vec::new()),
    };

    // Thumbnails above the bubble, right-aligned like the bubble itself
    // (port of UserMessageView; audio playback is still a TODO chip).
    let thumbs = images
        .iter()
        .filter_map(|item| {
            let ContentItem::Image {
                data,
                mime_type,
                url,
            } = item
            else {
                return None;
            };
            use crate::state::images::{resolve_image, ImageSlot};
            let el = match resolve_image(data.as_deref(), mime_type, url.as_deref(), cx) {
                ImageSlot::Ready(image) => gpui::img(image)
                    .rounded_lg()
                    .max_w(px(220.))
                    .max_h(px(220.))
                    .into_any_element(),
                ImageSlot::Loading => div()
                    .size(px(64.))
                    .rounded_lg()
                    .bg(cx.theme().muted)
                    .into_any_element(),
                ImageSlot::Failed => div()
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(cx.theme().muted)
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child("image unavailable")
                    .into_any_element(),
            };
            Some(el)
        })
        .collect::<Vec<_>>();

    row(div()
        .w_full()
        .v_flex()
        .items_end()
        .gap_1p5()
        .when(!thumbs.is_empty(), |this| {
            this.child(
                div()
                    .h_flex()
                    .gap_1p5()
                    .flex_wrap()
                    .justify_end()
                    .max_w(px(560.))
                    .children(thumbs),
            )
        })
        .child(
            div()
                .max_w(px(560.))
                .px_3()
                .py_2()
                .rounded_lg()
                .bg(cx.theme().muted)
                .v_flex()
                .gap_1()
                .when(!audio_urls.is_empty(), |this| {
                    this.children(audio_urls.iter().enumerate().map(|(i, url)| {
                        use crate::state::audio_player::{play_state, toggle, PlayState};
                        let (label, icon) = match play_state(url, cx) {
                            PlayState::Playing => ("playing", IconName::CircleX),
                            PlayState::Loading => ("loading…", IconName::LoaderCircle),
                            PlayState::Idle => ("voice message", IconName::ArrowRight),
                        };
                        let url = url.clone();
                        div()
                            .id(SharedString::from(format!("audio-{id}-{i}")))
                            .h_flex()
                            .gap_1()
                            .px_2()
                            .py_0p5()
                            .rounded_md()
                            .bg(cx.theme().background)
                            .text_xs()
                            .cursor_pointer()
                            .hover(|this| this.bg(cx.theme().list_hover))
                            .child(
                                Icon::new(icon)
                                    .xsmall()
                                    .text_color(cx.theme().muted_foreground),
                            )
                            .child(label)
                            .on_click(move |_, _, cx| toggle(&url, cx))
                    }))
                })
                .child(md(SharedString::from(format!("md-{id}")), text, window, cx)),
        )
        .into_any_element())
    .into_any_element()
}

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------

fn render_assistant(
    id: &str,
    content: &[ContentItem],
    error_message: Option<&str>,
    tool_results: &HashMap<String, ToolResultInfo>,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let mut column = div().w_full().v_flex().gap_2();

    for (i, item) in content.iter().enumerate() {
        match item {
            ContentItem::Text { text, .. } => {
                if !text.trim().is_empty() {
                    column = column.child(md(
                        SharedString::from(format!("md-{id}-{i}")),
                        text.clone(),
                        window,
                        cx,
                    ));
                }
            }
            ContentItem::Thinking { thinking, .. } => {
                column = column.child(collapsible_card(
                    format!("think-{id}-{i}"),
                    IconName::Bot,
                    "Thinking".into(),
                    format!("{} chars", thinking.len()),
                    thinking.clone(),
                    false,
                    window,
                    cx,
                ));
            }
            ContentItem::ToolCall {
                id: call_id,
                name,
                arguments,
                ..
            } => {
                let result = tool_results.get(call_id);
                // Known tools with a successful result get their special
                // card (same dispatch as MessageEntryView.tsx).
                if let Some(result) = result.filter(|r| !r.is_error) {
                    if let Some(card) = crate::views::tool_cards::render_special(
                        call_id,
                        name,
                        arguments,
                        Some(&result.text),
                        result.details.as_ref(),
                        window,
                        cx,
                    ) {
                        column = column.child(card);
                        continue;
                    }
                }
                column = column.child(match result {
                    // Generic call-with-result: collapsible, output in the
                    // body (truncated like the React ToolCard).
                    Some(result) => collapsible_card(
                        format!("result-{call_id}"),
                        if result.is_error {
                            IconName::TriangleAlert
                        } else {
                            IconName::Check
                        },
                        if result.is_error {
                            format!("{name} · error")
                        } else {
                            name.clone()
                        },
                        summarize_args(name, arguments),
                        format!("```\n{}\n```", truncate(&result.text, 1000)),
                        false,
                        window,
                        cx,
                    )
                    .into_any_element(),
                    // No result recorded (aborted turn): bare call card.
                    None => tool_call_card(call_id, name, arguments, cx).into_any_element(),
                });
            }
            _ => {}
        }
    }

    if let Some(error) = error_message {
        column = column.child(
            div()
                .px_3()
                .py_2()
                .rounded_md()
                .border_1()
                .border_color(cx.theme().danger)
                .text_sm()
                .text_color(cx.theme().danger)
                .child(error.to_string()),
        );
    }

    row(column.into_any_element()).into_any_element()
}

fn tool_call_card(
    call_id: &str,
    name: &str,
    arguments: &serde_json::Value,
    cx: &mut App,
) -> impl IntoElement {
    let args_summary = summarize_args(name, arguments);
    // report_artifact cards open the artifact panel.
    let artifact_path = (name == "report_artifact")
        .then(|| {
            arguments
                .get("path")
                .and_then(|p| p.as_str())
                .map(str::to_string)
        })
        .flatten();

    div()
        .id(SharedString::from(format!("tool-{call_id}")))
        .w_full()
        .px_3()
        .py_1p5()
        .rounded_md()
        .border_1()
        .border_color(cx.theme().border)
        .h_flex()
        .gap_2()
        .text_sm()
        .child(
            Icon::new(if artifact_path.is_some() {
                IconName::Frame
            } else {
                IconName::SquareTerminal
            })
            .small()
            .text_color(cx.theme().muted_foreground),
        )
        .child(div().font_semibold().child(name.to_string()))
        .child(
            div()
                .flex_1()
                .truncate()
                .text_color(cx.theme().muted_foreground)
                .child(args_summary),
        )
        .when_some(artifact_path, |this, path| {
            this.cursor_pointer()
                .hover(|this| this.bg(cx.theme().list_hover))
                .on_click(move |_, _, cx| {
                    crate::state::ui::open_artifact(path.clone(), cx);
                })
        })
}

/// One-line argument preview, mirroring the special handling of common tools
/// in the React `ToolCard`.
fn summarize_args(name: &str, args: &serde_json::Value) -> String {
    let pick = |keys: &[&str]| -> Option<String> {
        keys.iter()
            .find_map(|k| args.get(k).and_then(|v| v.as_str()).map(str::to_string))
    };
    let summary = match name {
        "bash" => pick(&["cmd", "command"]),
        "read" | "write" | "edit" => pick(&["path", "file_path"]),
        "web_search" => pick(&["query"]),
        "web_fetch" => pick(&["url"]),
        "report_artifact" => pick(&["path", "title"]),
        _ => None,
    };
    let text = summary.unwrap_or_else(|| {
        let s = args.to_string();
        if s == "null" {
            String::new()
        } else {
            s
        }
    });
    truncate(&text, 120)
}

// ---------------------------------------------------------------------------
// Bash
// ---------------------------------------------------------------------------

fn render_bash(
    id: &str,
    command: &str,
    output: &str,
    exit_code: Option<i32>,
    cancelled: bool,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let status = if cancelled {
        Some(("cancelled".to_string(), cx.theme().warning))
    } else {
        match exit_code {
            Some(0) | None => None,
            Some(code) => Some((format!("exit {code}"), cx.theme().danger)),
        }
    };

    let body = format!("```console\n$ {command}\n{}\n```", truncate(output, 2000));

    row(div()
        .w_full()
        .v_flex()
        .gap_1()
        .child(md(
            SharedString::from(format!("md-{id}-bash")),
            body,
            window,
            cx,
        ))
        .when_some(status, |this, (label, color)| {
            this.child(div().text_xs().text_color(color).child(label))
        })
        .into_any_element())
    .into_any_element()
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/// Standard row container: horizontal padding + vertical spacing for one entry.
fn row(child: AnyElement) -> Div {
    div().w_full().px_4().py_2().child(child)
}

fn divider(label: &'static str, detail: Option<String>, cx: &mut App) -> impl IntoElement {
    div()
        .w_full()
        .px_4()
        .py_2()
        .v_flex()
        .gap_1()
        .items_center()
        .child(
            div()
                .text_xs()
                .text_color(cx.theme().muted_foreground)
                .child(format!("— {label} —")),
        )
        .when_some(detail, |this, detail| {
            this.child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .max_w(px(560.))
                    .truncate()
                    .child(truncate(&detail, 200)),
            )
        })
}

fn system_line(text: String, cx: &mut App) -> impl IntoElement {
    div()
        .w_full()
        .px_4()
        .py_1()
        .text_xs()
        .text_color(cx.theme().muted_foreground)
        .child(text)
}

/// Card with a header line that toggles its body (window-keyed open state).
#[allow(clippy::too_many_arguments)]
fn collapsible_card(
    key: String,
    icon: IconName,
    title: String,
    meta: String,
    body: String,
    default_open: bool,
    window: &mut Window,
    cx: &mut App,
) -> impl IntoElement {
    let key = SharedString::from(key);
    let open_state = window.use_keyed_state(key.clone(), cx, |_, _| default_open);
    let open = *open_state.read(cx);

    div()
        .w_full()
        .rounded_md()
        .border_1()
        .border_color(cx.theme().border)
        .v_flex()
        .child(
            div()
                .id(key.clone())
                .px_3()
                .py_1p5()
                .h_flex()
                .gap_2()
                .text_sm()
                .cursor_pointer()
                .hover(|this| this.bg(cx.theme().list_hover))
                .child(
                    Icon::new(if open {
                        IconName::ChevronDown
                    } else {
                        IconName::ChevronRight
                    })
                    .small()
                    .text_color(cx.theme().muted_foreground),
                )
                .child(
                    Icon::new(icon)
                        .small()
                        .text_color(cx.theme().muted_foreground),
                )
                .child(div().font_semibold().child(title))
                .child(
                    div()
                        .text_xs()
                        .text_color(cx.theme().muted_foreground)
                        .child(meta),
                )
                .on_click({
                    let open_state = open_state.clone();
                    move |_, _, cx| {
                        open_state.update(cx, |open, cx| {
                            *open = !*open;
                            cx.notify();
                        });
                    }
                }),
        )
        .when(open, |this| {
            this.child(
                div()
                    .px_3()
                    .py_2()
                    .border_t_1()
                    .border_color(cx.theme().border)
                    .text_sm()
                    .child(md(
                        SharedString::from(format!("{key}-body")),
                        body,
                        window,
                        cx,
                    )),
            )
        })
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max).collect();
        format!("{truncated}…")
    }
}
