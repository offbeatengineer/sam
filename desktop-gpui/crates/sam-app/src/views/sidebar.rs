//! Left sidebar: sessions grouped by channel (app / discord / pulse), with
//! collapse, selection, and a rename/archive context menu.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use gpui::{div, prelude::*, px, App, Context, Entity, SharedString, Window};
use gpui_component::{
    input::{Input, InputState},
    menu::{ContextMenuExt, PopupMenuItem},
    ActiveTheme, Icon, IconName, Sizable, StyledExt, WindowExt,
};
use sam_protocol::SessionInfoDto;

use crate::state::sessions::SessionStore;

fn open_rename_dialog(
    store: Entity<SessionStore>,
    session: SessionInfoDto,
    window: &mut Window,
    cx: &mut App,
) {
    let input = cx.new(|cx| {
        InputState::new(window, cx)
            .placeholder("Session name")
            .default_value(session.name.clone().unwrap_or_default())
    });
    let path = session.path.clone();
    window.open_dialog(cx, move |dialog, _, _| {
        let store = store.clone();
        let input = input.clone();
        let path = path.clone();
        dialog
            .title("Rename session")
            .child(Input::new(&input))
            .confirm()
            .on_ok(move |_, _, cx| {
                let name = input.read(cx).value().trim().to_string();
                if !name.is_empty() {
                    store.update(cx, |store, cx| store.rename_session(path.clone(), name, cx));
                }
                true
            })
    });
}

pub struct Sidebar {
    store: Entity<SessionStore>,
    collapsed: HashSet<String>,
}

impl Sidebar {
    pub fn new(store: Entity<SessionStore>, cx: &mut Context<Self>) -> Self {
        cx.observe(&store, |_, _, cx| cx.notify()).detach();
        Self {
            store,
            collapsed: HashSet::new(),
        }
    }

    fn toggle_group(&mut self, channel: String, cx: &mut Context<Self>) {
        if !self.collapsed.remove(&channel) {
            self.collapsed.insert(channel);
        }
        cx.notify();
    }
}

fn channel_order(channel: &str) -> u8 {
    match channel {
        "app" => 0,
        "discord" => 1,
        "pulse" => 2,
        _ => 3,
    }
}

fn channel_label(channel: &str) -> String {
    match channel {
        "app" => "App".to_string(),
        "discord" => "Discord".to_string(),
        "pulse" => "Pulse".to_string(),
        other => other.to_string(),
    }
}

fn relative_time(iso: &str) -> String {
    let Ok(time) = DateTime::parse_from_rfc3339(iso) else {
        return String::new();
    };
    let delta = Utc::now().signed_duration_since(time.with_timezone(&Utc));
    let minutes = delta.num_minutes();
    if minutes < 1 {
        "now".into()
    } else if minutes < 60 {
        format!("{minutes}m")
    } else if delta.num_hours() < 24 {
        format!("{}h", delta.num_hours())
    } else {
        format!("{}d", delta.num_days())
    }
}

impl Render for Sidebar {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let store = self.store.read(cx);
        let active_path = store.active.as_ref().map(|a| a.info.path.clone());

        let mut groups: Vec<(String, Vec<SessionInfoDto>)> = Vec::new();
        for session in &store.sessions {
            match groups.iter_mut().find(|(c, _)| c == &session.channel_id) {
                Some((_, list)) => list.push(session.clone()),
                None => groups.push((session.channel_id.clone(), vec![session.clone()])),
            }
        }
        groups.sort_by_key(|(channel, _)| channel_order(channel));

        let mut root = div()
            .id("sidebar-scroll")
            .h_full()
            .w(px(260.))
            .flex_none()
            .overflow_y_scroll()
            .bg(cx.theme().sidebar)
            .text_color(cx.theme().sidebar_foreground)
            .border_r_1()
            .border_color(cx.theme().sidebar_border)
            .v_flex()
            .py_2()
            .child(
                div().px_3().pb_2().child(
                    gpui_component::button::Button::new("new-session")
                        .icon(IconName::Plus)
                        .label("New session")
                        .w_full()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.store.update(cx, |store, cx| store.new_session(cx));
                        })),
                ),
            );

        if groups.is_empty() {
            root = root.child(
                div()
                    .px_4()
                    .py_2()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .child("No sessions yet"),
            );
        }

        for (channel, sessions) in groups {
            let is_collapsed = self.collapsed.contains(&channel);
            let header_channel = channel.clone();
            root = root.child(
                div()
                    .id(SharedString::from(format!("group-{channel}")))
                    .px_3()
                    .py_1()
                    .h_flex()
                    .gap_1()
                    .text_xs()
                    .font_semibold()
                    .text_color(cx.theme().muted_foreground)
                    .cursor_pointer()
                    .child(
                        Icon::new(if is_collapsed {
                            IconName::ChevronRight
                        } else {
                            IconName::ChevronDown
                        })
                        .xsmall(),
                    )
                    .child(format!("{} ({})", channel_label(&channel), sessions.len()))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.toggle_group(header_channel.clone(), cx);
                    })),
            );

            if is_collapsed {
                continue;
            }

            for session in sessions {
                let selected = active_path.as_deref() == Some(session.path.as_str());
                let title = session
                    .name
                    .clone()
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| session.first_message.clone());
                let title: String = title.chars().take(60).collect();
                let meta = format!(
                    "{} · {} msgs",
                    relative_time(&session.modified),
                    session.message_count
                );
                let dto = session.clone();
                let item = div()
                    .id(SharedString::from(format!("session-{}", session.path)))
                    .mx_2()
                    .px_2()
                    .py_1p5()
                    .rounded_md()
                    .cursor_pointer()
                    .when(selected, |this| this.bg(cx.theme().list_active))
                    .when(!selected, |this| {
                        this.hover(|this| this.bg(cx.theme().list_hover))
                    })
                    .v_flex()
                    .gap_0p5()
                    .child(div().text_sm().truncate().child(title))
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(meta),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let dto = dto.clone();
                        this.store
                            .update(cx, |store, cx| store.select_session(dto, cx));
                    }));

                let menu_store = self.store.clone();
                let menu_session = session.clone();
                // Unique wrapper id scopes the inner context-menu's element
                // state per session row.
                root = root.child(
                    div()
                        .id(SharedString::from(format!("ctx-{}", session.path)))
                        .child(item.context_menu(move |menu, _, _| {
                        let rename_store = menu_store.clone();
                        let rename_session = menu_session.clone();
                        let archive_store = menu_store.clone();
                        let archive_path = menu_session.path.clone();
                        menu.item(PopupMenuItem::new("Rename…").on_click(
                            move |_, window, cx| {
                                open_rename_dialog(
                                    rename_store.clone(),
                                    rename_session.clone(),
                                    window,
                                    cx,
                                );
                            },
                        ))
                        .item(PopupMenuItem::new("Archive").on_click(move |_, _, cx| {
                            archive_store.update(cx, |store, cx| {
                                store.archive_session(archive_path.clone(), cx)
                            });
                        }))
                        })),
                );
            }
        }

        root
    }
}
