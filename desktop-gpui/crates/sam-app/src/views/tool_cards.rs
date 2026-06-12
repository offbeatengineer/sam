//! Special cards for completed tool calls in the streaming view — port of
//! the per-tool dispatch in `StreamingTurnView.tsx` (ArtifactCard,
//! WebSearchCard, WebFetchCard, MemoryCard, MemoryRecallCard,
//! SessionSearchCard, SessionReadCard, KitCreateCard). Favicons/OG images
//! are intentionally skipped in the native port; hosts render as text.

use gpui::{div, prelude::*, AnyElement, App, SharedString, Window};
use gpui_component::{ActiveTheme, Icon, IconName, Sizable, StyledExt};
use serde_json::Value;

/// Render a completed tool call as its tool-specific card. Returns None for
/// tools without one (or unparseable payloads) — the caller falls back to
/// the generic card.
pub fn render_special(
    id: &str,
    name: &str,
    args: &Value,
    result: Option<&str>,
    details: Option<&Value>,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    match name {
        "report_artifact" => artifact_card(details.or(Some(args))?, cx),
        "web_search" => web_search_card(id, details?, window, cx),
        "web_fetch" => web_fetch_card(details?, cx),
        "memory_save" | "memory_update" | "memory_forget" => memory_card(details?, cx),
        "memory_recall" => memory_recall_card(id, args, result?, window, cx),
        "session_search" => session_search_card(id, args, result?, window, cx),
        "session_read" => session_read_card(id, result?, window, cx),
        "manage_kit" => kit_create_card(details?, cx),
        _ => None,
    }
}

fn str_of<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn host_of(url: &str) -> &str {
    url.split("://")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or(url)
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>())
    }
}

fn relative_time_ms(ts: f64) -> String {
    let now = chrono::Utc::now().timestamp_millis() as f64;
    let mins = ((now - ts) / 60_000.0).max(0.0) as i64;
    if mins < 1 {
        "just now".into()
    } else if mins < 60 {
        format!("{mins}m ago")
    } else if mins < 24 * 60 {
        format!("{}h ago", mins / 60)
    } else {
        format!("{}d ago", mins / (24 * 60))
    }
}

/// Card frame shared by all special cards.
fn shell(cx: &App) -> gpui::Div {
    div()
        .w_full()
        .rounded_md()
        .border_1()
        .border_color(cx.theme().border)
        .overflow_hidden()
        .v_flex()
}

/// Header line + expandable rows (open state keyed on the tool call id).
fn expandable(
    key: String,
    icon: IconName,
    title: String,
    meta: String,
    rows: Vec<AnyElement>,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let key = SharedString::from(key);
    let open_state = window.use_keyed_state(key.clone(), cx, |_, _| false);
    let open = *open_state.read(cx);

    shell(cx)
        .child(
            div()
                .id(key)
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
                .child(div().flex_1().truncate().font_semibold().child(title))
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
            this.children(rows.into_iter().map(|row| {
                div()
                    .border_t_1()
                    .border_color(cx.theme().border)
                    .child(row)
            }))
        })
        .into_any_element()
}

fn tag_pill(text: String, cx: &App) -> impl IntoElement {
    div()
        .px_1p5()
        .py_0p5()
        .rounded_full()
        .bg(cx.theme().muted)
        .text_xs()
        .text_color(cx.theme().muted_foreground)
        .child(text)
}

fn role_chip(role: String, cx: &App) -> impl IntoElement {
    div()
        .px_1p5()
        .py_0p5()
        .rounded_sm()
        .bg(cx.theme().muted)
        .text_xs()
        .font_semibold()
        .child(role)
}

// ---------------------------------------------------------------------------
// report_artifact — clickable, opens the artifact panel
// ---------------------------------------------------------------------------

fn artifact_card(details: &Value, cx: &mut App) -> Option<AnyElement> {
    let path = str_of(details, "path")?.to_string();
    let title = str_of(details, "title").unwrap_or(&path).to_string();
    let description = str_of(details, "description").map(str::to_string);
    let kind = str_of(details, "type").unwrap_or("file");
    let icon = match kind {
        "html" => IconName::Globe,
        "image" => IconName::Frame,
        "markdown" => IconName::BookOpen,
        "code" => IconName::SquareTerminal,
        "data" => IconName::ChartPie,
        _ => IconName::File,
    };

    Some(
        shell(cx)
            .id(SharedString::from(format!("artifact-{path}")))
            .px_3()
            .py_2()
            .h_flex()
            .gap_2()
            .cursor_pointer()
            .hover(|this| this.bg(cx.theme().list_hover))
            .child(
                Icon::new(icon)
                    .small()
                    .text_color(cx.theme().muted_foreground),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .v_flex()
                    .child(div().text_sm().font_semibold().truncate().child(title))
                    .when_some(description, |this, d| {
                        this.child(
                            div()
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .truncate()
                                .child(clip(&d, 160)),
                        )
                    }),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child(kind.to_string()),
            )
            .on_click(move |_, _, cx| {
                crate::state::ui::open_artifact(path.clone(), cx);
            })
            .into_any_element(),
    )
}

// ---------------------------------------------------------------------------
// web_search — expandable result list, rows open in the browser
// ---------------------------------------------------------------------------

fn web_search_card(
    id: &str,
    details: &Value,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    let query = str_of(details, "query")?.to_string();
    let provider = str_of(details, "provider").unwrap_or("").to_string();
    let results = details.get("results")?.as_array()?;

    let rows = results
        .iter()
        .enumerate()
        .filter_map(|(i, r)| {
            let title = str_of(r, "title")?.to_string();
            let url = str_of(r, "url")?.to_string();
            let description = str_of(r, "description").map(str::to_string);
            let age = str_of(r, "age").map(str::to_string);
            let site = str_of(r, "siteName")
                .map(str::to_string)
                .unwrap_or_else(|| host_of(&url).to_string());
            let open_url = url.clone();
            Some(
                div()
                    .id(SharedString::from(format!("ws-{id}-{i}")))
                    .px_3()
                    .py_2()
                    .v_flex()
                    .gap_0p5()
                    .cursor_pointer()
                    .hover(|this| this.bg(cx.theme().list_hover))
                    .child(div().text_sm().font_semibold().truncate().child(title))
                    .child(
                        div()
                            .h_flex()
                            .gap_2()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(site)
                            .when_some(age, |this, age| this.child(age)),
                    )
                    .when_some(description, |this, d| {
                        this.child(
                            div()
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .child(clip(&d, 200)),
                        )
                    })
                    .on_click(move |_, _, cx| cx.open_url(&open_url))
                    .into_any_element(),
            )
        })
        .collect::<Vec<_>>();

    let meta = format!(
        "{provider}{}{} results",
        if provider.is_empty() { "" } else { " · " },
        rows.len()
    );
    Some(expandable(
        format!("wsearch-{id}"),
        IconName::Search,
        query,
        meta,
        rows,
        window,
        cx,
    ))
}

// ---------------------------------------------------------------------------
// web_fetch — clickable summary card
// ---------------------------------------------------------------------------

fn web_fetch_card(details: &Value, cx: &mut App) -> Option<AnyElement> {
    let url = str_of(details, "url")?.to_string();
    let title = str_of(details, "title").unwrap_or(&url).to_string();
    let description = str_of(details, "description").map(str::to_string);
    let site = str_of(details, "siteName")
        .map(str::to_string)
        .unwrap_or_else(|| host_of(&url).to_string());
    let length = details
        .get("contentLength")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let truncated = details
        .get("truncated")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let size = if length < 1024 {
        format!("{length} chars")
    } else {
        format!("{:.1}K chars", length as f64 / 1024.0)
    };
    let open_url = url.clone();

    Some(
        shell(cx)
            .id(SharedString::from(format!("wfetch-{url}")))
            .px_3()
            .py_2()
            .v_flex()
            .gap_0p5()
            .cursor_pointer()
            .hover(|this| this.bg(cx.theme().list_hover))
            .child(
                div()
                    .h_flex()
                    .gap_2()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child(Icon::new(IconName::Globe).xsmall())
                    .child(site)
                    .child(format!(
                        "{size}{}",
                        if truncated { " · truncated" } else { "" }
                    )),
            )
            .child(div().text_sm().font_semibold().truncate().child(title))
            .when_some(description, |this, d| {
                this.child(
                    div()
                        .text_xs()
                        .text_color(cx.theme().muted_foreground)
                        .child(clip(&d, 200)),
                )
            })
            .on_click(move |_, _, cx| cx.open_url(&open_url))
            .into_any_element(),
    )
}

// ---------------------------------------------------------------------------
// memory_save / memory_update / memory_forget
// ---------------------------------------------------------------------------

fn memory_card(details: &Value, cx: &mut App) -> Option<AnyElement> {
    let action = str_of(details, "action")?;
    let id = str_of(details, "id").unwrap_or("");
    let label = match action {
        "saved" => "Memory saved".to_string(),
        "updated" => "Memory updated".to_string(),
        "forgotten" => "Memory forgotten".to_string(),
        other => format!("Memory {other}"),
    };
    let text = str_of(details, "text").map(str::to_string);
    let tags: Vec<String> = details
        .get("tags")
        .and_then(|t| t.as_array())
        .map(|tags| {
            tags.iter()
                .filter_map(|t| t.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    Some(
        shell(cx)
            .px_3()
            .py_2()
            .h_flex()
            .gap_2()
            .items_start()
            .child(
                Icon::new(IconName::BookOpen)
                    .small()
                    .text_color(cx.theme().muted_foreground),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .v_flex()
                    .gap_0p5()
                    .child(
                        div()
                            .h_flex()
                            .gap_2()
                            .child(div().text_sm().font_semibold().child(label))
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(cx.theme().muted_foreground)
                                    .child(id.chars().take(8).collect::<String>()),
                            ),
                    )
                    .when_some(text, |this, text| {
                        this.child(
                            div()
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .child(clip(&text, 200)),
                        )
                    })
                    .when(!tags.is_empty(), |this| {
                        this.child(
                            div()
                                .h_flex()
                                .gap_1()
                                .flex_wrap()
                                .children(tags.into_iter().map(|t| tag_pill(t, cx))),
                        )
                    }),
            )
            .into_any_element(),
    )
}

// ---------------------------------------------------------------------------
// memory_recall — expandable matches list (parsed from the result JSON)
// ---------------------------------------------------------------------------

fn memory_recall_card(
    id: &str,
    args: &Value,
    result: &str,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    let query = str_of(args, "query").unwrap_or("").to_string();
    let parsed: Value = serde_json::from_str(result).ok()?;
    let results = parsed.get("results")?.as_array()?;

    let rows = results
        .iter()
        .filter_map(|r| {
            let text = str_of(r, "text")?.to_string();
            let score = r.get("score").and_then(|s| s.as_f64());
            let tags: Vec<String> = r
                .get("tags")
                .and_then(|t| t.as_array())
                .map(|tags| {
                    tags.iter()
                        .filter_map(|t| t.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            Some(
                div()
                    .px_3()
                    .py_2()
                    .v_flex()
                    .gap_1()
                    .child(div().text_xs().child(clip(&text, 240)))
                    .when(!tags.is_empty() || score.is_some(), |this| {
                        this.child(
                            div()
                                .h_flex()
                                .gap_1()
                                .flex_wrap()
                                .children(tags.into_iter().map(|t| tag_pill(t, cx)))
                                .when_some(score, |this, score| {
                                    this.child(
                                        div()
                                            .text_xs()
                                            .text_color(cx.theme().muted_foreground)
                                            .child(format!("{score:.2}")),
                                    )
                                }),
                        )
                    })
                    .into_any_element(),
            )
        })
        .collect::<Vec<_>>();

    let meta = format!(
        "{} {}",
        rows.len(),
        if rows.len() == 1 {
            "memory"
        } else {
            "memories"
        }
    );
    Some(expandable(
        format!("mrecall-{id}"),
        IconName::BookOpen,
        query,
        meta,
        rows,
        window,
        cx,
    ))
}

// ---------------------------------------------------------------------------
// session_search — expandable hit list
// ---------------------------------------------------------------------------

fn session_search_card(
    id: &str,
    args: &Value,
    result: &str,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    let query = str_of(args, "query").unwrap_or("").to_string();
    let parsed: Value = serde_json::from_str(result).ok()?;
    let results = parsed.get("results")?.as_array()?;

    let rows = results
        .iter()
        .filter_map(|r| {
            let text = str_of(r, "text")?.to_string();
            let role = str_of(r, "role").unwrap_or("?").to_string();
            let session = str_of(r, "session_name")
                .or_else(|| str_of(r, "sessionName"))
                .unwrap_or("")
                .to_string();
            let when = r
                .get("timestamp")
                .and_then(|t| t.as_f64())
                .map(relative_time_ms);
            Some(
                div()
                    .px_3()
                    .py_2()
                    .v_flex()
                    .gap_1()
                    .child(
                        div()
                            .h_flex()
                            .gap_2()
                            .items_center()
                            .child(role_chip(role, cx))
                            .when(!session.is_empty(), |this| {
                                this.child(
                                    div()
                                        .text_xs()
                                        .text_color(cx.theme().muted_foreground)
                                        .truncate()
                                        .child(session),
                                )
                            })
                            .when_some(when, |this, when| {
                                this.child(
                                    div()
                                        .text_xs()
                                        .text_color(cx.theme().muted_foreground)
                                        .child(when),
                                )
                            }),
                    )
                    .child(div().text_xs().child(clip(&text, 240)))
                    .into_any_element(),
            )
        })
        .collect::<Vec<_>>();

    let meta = format!(
        "{} {}",
        rows.len(),
        if rows.len() == 1 { "result" } else { "results" }
    );
    Some(expandable(
        format!("ssearch-{id}"),
        IconName::Search,
        query,
        meta,
        rows,
        window,
        cx,
    ))
}

// ---------------------------------------------------------------------------
// session_read — expandable message excerpt
// ---------------------------------------------------------------------------

fn session_read_card(
    id: &str,
    result: &str,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    let parsed: Value = serde_json::from_str(result).ok()?;
    let name = str_of(&parsed, "session_name")
        .or_else(|| str_of(&parsed, "sessionName"))
        .unwrap_or("Session")
        .to_string();
    let messages = parsed.get("messages")?.as_array()?;
    let total = parsed
        .get("total_messages")
        .or_else(|| parsed.get("totalMessages"))
        .and_then(|t| t.as_u64())
        .unwrap_or(messages.len() as u64);

    let rows = messages
        .iter()
        .filter_map(|m| {
            let text = str_of(m, "text")?.to_string();
            let role = str_of(m, "role").unwrap_or("?").to_string();
            Some(
                div()
                    .px_3()
                    .py_2()
                    .h_flex()
                    .gap_2()
                    .items_start()
                    .child(role_chip(role, cx))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(clip(&text, 240)),
                    )
                    .into_any_element(),
            )
        })
        .collect::<Vec<_>>();

    let meta = format!("{} of {total} messages", rows.len());
    Some(expandable(
        format!("sread-{id}"),
        IconName::Inbox,
        name,
        meta,
        rows,
        window,
        cx,
    ))
}

// ---------------------------------------------------------------------------
// manage_kit (create)
// ---------------------------------------------------------------------------

fn kit_create_card(details: &Value, cx: &mut App) -> Option<AnyElement> {
    let manifest = details.get("manifest")?;
    let name = str_of(manifest, "name")?.to_string();
    let kit_id = str_of(manifest, "id").unwrap_or("").to_string();
    let description = str_of(manifest, "description").map(str::to_string);
    let version = str_of(manifest, "version").map(str::to_string);

    Some(
        shell(cx)
            .px_3()
            .py_2()
            .h_flex()
            .gap_2()
            .items_start()
            .child(
                Icon::new(IconName::LayoutDashboard)
                    .small()
                    .text_color(cx.theme().muted_foreground),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .v_flex()
                    .gap_0p5()
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child("Kit created"),
                    )
                    .child(div().text_sm().font_semibold().child(name))
                    .when_some(description, |this, d| {
                        this.child(
                            div()
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .child(clip(&d, 160)),
                        )
                    })
                    .child(
                        div()
                            .h_flex()
                            .gap_2()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(kit_id)
                            .when_some(version, |this, v| this.child(format!("v{v}"))),
                    ),
            )
            .into_any_element(),
    )
}
