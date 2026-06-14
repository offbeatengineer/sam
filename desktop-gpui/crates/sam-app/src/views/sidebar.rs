//! Left sidebar: sessions grouped by channel (app / discord / pulse), with
//! collapse, selection, a session-search box, a rename/archive context menu,
//! and a lazy-loaded archived-sessions group.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use gpui::{
    div, prelude::*, px, AnyElement, App, Context, Entity, SharedString, Subscription, Window,
};
use gpui_component::{
    input::{Input, InputEvent, InputState},
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
    archived_expanded: bool,
    search_input: Entity<InputState>,
    _subscriptions: Vec<Subscription>,
}

impl Sidebar {
    pub fn new(store: Entity<SessionStore>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        cx.observe(&store, |_, _, cx| cx.notify()).detach();

        let search_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("Search sessions…"));

        // Enter runs the search; emptying the box (typed or via the clear
        // button) drops back to the full list — port of LeftSidebar's
        // onKeyDown/onChange handlers.
        let sub = cx.subscribe_in(
            &search_input,
            window,
            |this: &mut Self, input, event: &InputEvent, _, cx| match event {
                InputEvent::PressEnter { .. } => {
                    let query = input.read(cx).value().to_string();
                    this.store
                        .update(cx, |store, cx| store.search_sessions(query, cx));
                }
                InputEvent::Change => {
                    if input.read(cx).value().trim().is_empty() {
                        this.store.update(cx, |store, cx| store.clear_search(cx));
                    }
                }
                _ => {}
            },
        );

        Self {
            store,
            collapsed: HashSet::new(),
            archived_expanded: false,
            search_input,
            _subscriptions: vec![sub],
        }
    }

    fn toggle_group(&mut self, channel: String, cx: &mut Context<Self>) {
        if !self.collapsed.remove(&channel) {
            self.collapsed.insert(channel);
        }
        cx.notify();
    }

    fn toggle_archived(&mut self, cx: &mut Context<Self>) {
        self.archived_expanded = !self.archived_expanded;
        // Lazy-load on first expand (port of SessionList's archived onClick).
        if self.archived_expanded && !self.store.read(cx).archived_loaded {
            self.store.update(cx, |store, cx| store.load_archived(cx));
        }
        cx.notify();
    }

    /// One session row + its context menu (Rename/Archive for app sessions,
    /// Unarchive for archived ones, none for read-only channels).
    fn render_session_row(
        &self,
        session: &SessionInfoDto,
        selected: bool,
        archived: bool,
        streaming: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
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
            .min_w_0()
            .when(selected, |this| this.bg(cx.theme().list_active))
            .when(!selected, |this| {
                this.hover(|this| this.bg(cx.theme().list_hover))
            })
            .v_flex()
            .gap_0p5()
            .child(
                div()
                    .h_flex()
                    .items_center()
                    .gap_1p5()
                    .child(div().flex_1().min_w_0().text_sm().truncate().child(title))
                    // Pulsing-style "working" dot on a streaming session we're
                    // not currently viewing (port of SessionItem's blue dot).
                    .when(streaming && !selected, |this| {
                        this.child(
                            div()
                                .flex_none()
                                .size(px(8.))
                                .rounded_full()
                                .bg(gpui::rgb(0x3b82f6)),
                        )
                    }),
            )
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

        // Unique wrapper id scopes the inner context-menu's element state.
        let wrapper_id = SharedString::from(format!("ctx-{}", session.path));
        if archived {
            let store = self.store.clone();
            let path = session.path.clone();
            div()
                .id(wrapper_id)
                .w_full()
                .min_w_0()
                .child(item.context_menu(move |menu, _, _| {
                    let store = store.clone();
                    let path = path.clone();
                    menu.item(PopupMenuItem::new("Unarchive").on_click(move |_, _, cx| {
                        store.update(cx, |store, cx| store.unarchive_session(path.clone(), cx));
                    }))
                }))
                .into_any_element()
        } else if session.channel_id == "app" {
            let menu_store = self.store.clone();
            let menu_session = session.clone();
            div()
                .id(wrapper_id)
                .w_full()
                .min_w_0()
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
                    .item(
                        PopupMenuItem::new("Archive").on_click(move |_, _, cx| {
                            archive_store.update(cx, |store, cx| {
                                store.archive_session(archive_path.clone(), cx)
                            });
                        }),
                    )
                }))
                .into_any_element()
        } else {
            // discord / pulse: read-only, no menu (matches Tauri SessionItem).
            item.into_any_element()
        }
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
        // Snapshot what we need out of the store so its borrow ends before we
        // build listeners (which reborrow cx mutably).
        let (active_path, searching, search_active, visible, archived, archived_loaded, streaming_convs) = {
            let store = self.store.read(cx);
            let active_path = store.active.as_ref().map(|a| a.info.path.clone());
            let matches = store.search_matches.clone();
            let visible: Vec<SessionInfoDto> = store
                .sessions
                .iter()
                .filter(|s| {
                    matches
                        .as_ref()
                        .map_or(true, |ids| ids.contains(&s.conversation_id))
                })
                .cloned()
                .collect();
            (
                active_path,
                store.searching,
                matches.is_some(),
                visible,
                store.archived.clone(),
                store.archived_loaded,
                store
                    .background_turns
                    .keys()
                    .cloned()
                    .collect::<HashSet<String>>(),
            )
        };

        let mut groups: Vec<(String, Vec<SessionInfoDto>)> = Vec::new();
        for session in &visible {
            match groups.iter_mut().find(|(c, _)| c == &session.channel_id) {
                Some((_, list)) => list.push(session.clone()),
                None => groups.push((session.channel_id.clone(), vec![session.clone()])),
            }
        }
        groups.sort_by_key(|(channel, _)| channel_order(channel));

        // Content lives in a fixed-width column so its children stretch to a
        // definite width. Direct children of the overflow-scroll root don't get
        // one (that's why rows were content-width and the search box narrow).
        let mut root = div()
            .w(px(259.))
            .v_flex()
            .py_2()
            .child(
                div().px_3().pb_2().w_full().child(
                    gpui_component::button::Button::new("new-session")
                        .icon(IconName::Plus)
                        .label("New session")
                        .w_full()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.store.update(cx, |store, cx| store.new_session(cx));
                        })),
                ),
            )
            .child(
                div().px_3().pb_2().w_full().child(
                    Input::new(&self.search_input)
                        .w_full()
                        .small()
                        .cleanable(true)
                        .prefix(
                            Icon::new(IconName::Search)
                                .xsmall()
                                .text_color(cx.theme().muted_foreground),
                        ),
                ),
            );

        if searching {
            root = root.child(
                div()
                    .px_4()
                    .py_2()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .child("Searching…"),
            );
        } else if groups.is_empty() {
            root = root.child(
                div()
                    .px_4()
                    .py_2()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .child(if search_active {
                        "No matching sessions"
                    } else {
                        "No sessions yet"
                    }),
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
                let streaming = streaming_convs.contains(&session.conversation_id);
                root = root.child(self.render_session_row(&session, selected, false, streaming, cx));
            }
        }

        // Archived group — always present at the bottom, lazy-loaded on expand.
        let archived_expanded = self.archived_expanded;
        root = root.child(
            div()
                .id("group-archived")
                .px_3()
                .py_1()
                .h_flex()
                .gap_1()
                .text_xs()
                .font_semibold()
                .text_color(cx.theme().muted_foreground)
                .cursor_pointer()
                .child(
                    Icon::new(if archived_expanded {
                        IconName::ChevronDown
                    } else {
                        IconName::ChevronRight
                    })
                    .xsmall(),
                )
                .child(Icon::new(IconName::Inbox).xsmall())
                .child("Archived")
                .on_click(cx.listener(|this, _, _, cx| this.toggle_archived(cx))),
        );

        if archived_expanded {
            if archived.is_empty() {
                root = root.child(
                    div()
                        .px_4()
                        .py_2()
                        .text_xs()
                        .text_color(cx.theme().muted_foreground)
                        .child(if archived_loaded {
                            "No archived sessions"
                        } else {
                            "Loading…"
                        }),
                );
            } else {
                for session in archived {
                    let selected = active_path.as_deref() == Some(session.path.as_str());
                    root = root.child(self.render_session_row(&session, selected, true, false, cx));
                }
            }
        }

        div()
            .id("sidebar-scroll")
            .h_full()
            .w(px(260.))
            .flex_none()
            .overflow_y_scroll()
            .bg(cx.theme().sidebar)
            .text_color(cx.theme().sidebar_foreground)
            .border_r_1()
            .border_color(cx.theme().sidebar_border)
            .child(root)
    }
}
