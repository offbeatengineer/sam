//! Main chat area: header + virtualized message list over the active
//! session's entries. The composer (input) lands in M3.

use gpui::{
    div, list, prelude::*, px, Context, Entity, ListAlignment, ListState, SharedString, Window,
};
use gpui_component::{ActiveTheme, StyledExt};

use crate::state::sessions::SessionStore;
use crate::views::composer::Composer;
use crate::views::entries::{render_entry, render_pending_user, render_streaming};

pub struct ChatView {
    store: Entity<SessionStore>,
    composer: Entity<Composer>,
    list_state: ListState,
    /// (session path, total row count) the list_state was last reset for.
    rendered_key: Option<(String, usize)>,
    rendered_stream_revision: u64,
}

/// Rows = displayable entries ++ pending user message ++ live streaming turn.
fn row_count(store: &SessionStore) -> usize {
    let Some(active) = &store.active else {
        return 0;
    };
    active.display_indices.len()
        + usize::from(store.pending_user.is_some())
        + usize::from(store.streaming.is_some())
}

impl ChatView {
    pub fn new(
        store: Entity<SessionStore>,
        composer: Entity<Composer>,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.observe(&store, |this: &mut Self, _, cx| {
            this.sync_list(cx);
            cx.notify();
        })
        .detach();

        // Inline images resolve asynchronously; re-render visible rows when
        // one lands (row heights re-measure on the next layout pass).
        if let Some(cache) = cx
            .try_global::<crate::state::images::ImageCacheGlobal>()
            .map(|g| g.0.clone())
        {
            cx.observe(&cache, |_, _, cx| cx.notify()).detach();
        }
        // Same for audio chips flipping between idle/loading/playing.
        if let Some(player) = cx
            .try_global::<crate::state::audio_player::AudioPlayerGlobal>()
            .map(|g| g.0.clone())
        {
            cx.observe(&player, |_, _, cx| cx.notify()).detach();
        }

        Self {
            store,
            composer,
            list_state: ListState::new(0, ListAlignment::Bottom, px(512.)),
            rendered_key: None,
            rendered_stream_revision: 0,
        }
    }

    fn sync_list(&mut self, cx: &mut Context<Self>) {
        let store = self.store.read(cx);
        let key = store
            .active
            .as_ref()
            .map(|a| (a.info.path.clone(), row_count(store)));
        let revision = store.streaming.as_ref().map(|s| s.revision).unwrap_or(0);

        if key != self.rendered_key {
            let count = key.as_ref().map(|(_, c)| *c).unwrap_or(0);
            self.list_state.reset(count);
            self.rendered_key = key;
            self.rendered_stream_revision = revision;
        } else if revision != self.rendered_stream_revision {
            // Same shape, new deltas: invalidate only the live last row.
            let count = key.as_ref().map(|(_, c)| *c).unwrap_or(0);
            if count > 0 {
                self.list_state.splice(count - 1..count, 1);
            }
            self.rendered_stream_revision = revision;
        }
    }
}

impl Render for ChatView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let store = self.store.read(cx);
        let Some(active) = &store.active else {
            return div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .text_color(cx.theme().muted_foreground)
                .child("Select a session")
                .into_any_element();
        };

        let title = active
            .info
            .name
            .clone()
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| active.info.first_message.clone());
        let title: String = title.chars().take(80).collect();
        let read_only = active.info.channel_id != "app";
        let channel = active.info.channel_id.clone();
        let loading = active.loading;

        let store_handle = self.store.clone();
        let message_list = list(self.list_state.clone(), move |ix, window, cx| {
            enum Row {
                Entry(
                    sam_protocol::session::SessionEntry,
                    std::sync::Arc<
                        std::collections::HashMap<String, crate::state::sessions::ToolResultInfo>,
                    >,
                ),
                PendingUser(String),
                Streaming(Vec<crate::state::sessions::StreamItem>),
                None,
            }
            let row = {
                let store = store_handle.read(cx);
                match &store.active {
                    Some(active) => {
                        let display_count = active.display_indices.len();
                        if ix < display_count {
                            Row::Entry(
                                active.entries[active.display_indices[ix]].clone(),
                                active.tool_results.clone(),
                            )
                        } else if ix == display_count && store.pending_user.is_some() {
                            Row::PendingUser(store.pending_user.clone().unwrap_or_default())
                        } else if let Some(streaming) = &store.streaming {
                            Row::Streaming(streaming.items.clone())
                        } else {
                            Row::None
                        }
                    }
                    None => Row::None,
                }
            };
            match row {
                Row::Entry(entry, tool_results) => render_entry(&entry, &tool_results, window, cx),
                Row::PendingUser(text) => render_pending_user(&text, window, cx),
                Row::Streaming(items) => render_streaming(&items, window, cx),
                Row::None => div().into_any_element(),
            }
        })
        .flex_1()
        .w_full();

        div()
            .size_full()
            .v_flex()
            .child(
                div()
                    .w_full()
                    .px_4()
                    .py_2()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .h_flex()
                    .gap_2()
                    .child(div().text_sm().font_semibold().truncate().child(title))
                    .when(read_only, |this| {
                        this.child(
                            div()
                                .px_2()
                                .py_0p5()
                                .rounded_md()
                                .bg(cx.theme().muted)
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .child(SharedString::from(format!("read-only · {channel}"))),
                        )
                    }),
            )
            .map(|this| {
                if loading {
                    this.child(
                        div()
                            .flex_1()
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_color(cx.theme().muted_foreground)
                            .child("Loading…"),
                    )
                } else {
                    this.child(message_list)
                }
            })
            .when(!read_only, |this| this.child(self.composer.clone()))
            .into_any_element()
    }
}
