//! Root view: owns global entities, pumps IO events into app state, and
//! routes between pages. (Event dispatch grows in M2/M3 — port of
//! `desktop/src/components/chat/ChatContainer.tsx`.)

use futures::StreamExt;
use gpui::{div, prelude::*, Context, Entity, Window};
use gpui_component::ActiveTheme;
use sam_client::ClientEvent;
use sam_client::SamClient;

use crate::state::sessions::SessionStore;
use crate::state::ui::{UiState, UiStateGlobal};
use crate::state::{ConnectionState, ConnectionStatus};
use crate::views::artifact_panel::ArtifactPanel;
use crate::views::chat::ChatView;
use crate::views::composer::Composer;
use crate::views::right_sidebar::RightSidebar;
use crate::views::settings_form::{SettingsForm, SettingsFormEvent};
use crate::views::sidebar::Sidebar;
use crate::views::titlebar::render_titlebar;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Page {
    Chat,
    Settings,
}

pub struct SamApp {
    conn: Entity<ConnectionState>,
    sessions: Entity<SessionStore>,
    sidebar: Entity<Sidebar>,
    chat: Entity<ChatView>,
    artifact_panel: Entity<ArtifactPanel>,
    right_sidebar: Entity<RightSidebar>,
    ui: Entity<UiState>,
    settings_form: Entity<SettingsForm>,
    page: Page,
    autosend_done: bool,
    window_active: bool,
}

impl SamApp {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (client, mut events) = SamClient::new();
        let conn = cx.new(|_| ConnectionState::new(client.clone()));
        let sessions = cx.new(|_| SessionStore::new(client));
        let image_cache = cx.new(|_| crate::state::images::ImageCache::new(conn.clone()));
        cx.set_global(crate::state::images::ImageCacheGlobal(image_cache));
        let window_handle = window.window_handle();
        let audio_player = cx.new(|cx| {
            crate::state::audio_player::AudioPlayer::new(conn.clone(), window_handle, cx)
        });
        cx.set_global(crate::state::audio_player::AudioPlayerGlobal(audio_player));
        let sidebar = cx.new(|cx| Sidebar::new(sessions.clone(), window, cx));
        let composer = cx.new(|cx| Composer::new(sessions.clone(), conn.clone(), window, cx));
        let chat = cx.new(|cx| ChatView::new(sessions.clone(), composer, cx));
        let right_sidebar = cx.new(|cx| RightSidebar::new(sessions.clone(), cx));
        let ui = cx.new(|_| UiState::new());
        cx.set_global(UiStateGlobal(ui.clone()));
        cx.observe(&ui, |_, _, cx| cx.notify()).detach();
        let artifact_panel = cx.new(|cx| ArtifactPanel::new(ui.clone(), conn.clone(), cx));

        // Re-render the chrome (status dot) whenever connection state changes.
        cx.observe(&conn, |_, _, cx| cx.notify()).detach();

        // Track focus so turn-end notifications only fire in the background.
        cx.observe_window_activation(window, |this, window, _| {
            this.window_active = window.is_window_active();
        })
        .detach();

        // Follow live system light/dark switches (init() only syncs once).
        cx.observe_window_appearance(window, |_, window, cx| {
            gpui_component::Theme::sync_system_appearance(Some(window), cx);
        })
        .detach();

        let settings_form = cx.new(|cx| SettingsForm::new(conn.clone(), window, cx));
        cx.subscribe(&settings_form, |this, _, event, cx| match event {
            SettingsFormEvent::Saved => {
                this.page = Page::Chat;
                cx.notify();
            }
            SettingsFormEvent::SwitchedInstance => {
                this.sessions
                    .update(cx, |sessions, cx| sessions.clear_all(cx));
                this.page = Page::Chat;
                cx.notify();
            }
            SettingsFormEvent::ActiveInstanceRemoved => {
                this.sessions
                    .update(cx, |sessions, cx| sessions.clear_all(cx));
                cx.notify();
            }
        })
        .detach();

        // Single event pump: IO thread → app state, for the app's lifetime.
        cx.spawn(async move |this, cx| {
            while let Some(event) = events.next().await {
                if this
                    .update(cx, |app, cx| app.handle_client_event(event, cx))
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();

        let has_instance = conn.read(cx).active_instance().is_some();
        if has_instance {
            conn.update(cx, |conn, cx| conn.connect_active(cx));
        }

        Self {
            conn,
            sessions,
            sidebar,
            chat,
            artifact_panel,
            right_sidebar,
            ui,
            settings_form,
            // Dev hook: SAM_OPEN_SETTINGS=1 starts on the settings page.
            page: if has_instance && std::env::var("SAM_OPEN_SETTINGS").is_err() {
                Page::Chat
            } else {
                Page::Settings
            },
            autosend_done: false,
            window_active: window.is_window_active(),
        }
    }

    fn handle_client_event(&mut self, event: ClientEvent, cx: &mut Context<Self>) {
        match event {
            ClientEvent::Connected => {
                self.conn.update(cx, |conn, cx| {
                    conn.set_status(ConnectionStatus::Connected, cx)
                });
                // Sessions may have changed while we were away (or this is the
                // first connect) — refresh the list.
                self.sessions
                    .update(cx, |sessions, cx| sessions.load_sessions(cx));
                // Dev hook: SAM_AUTOSEND=<text> starts a new session and sends
                // a message on connect (headless streaming verification).
                if !self.autosend_done {
                    self.autosend_done = true;
                    if let Ok(text) = std::env::var("SAM_AUTOSEND") {
                        self.sessions.update(cx, |sessions, cx| {
                            sessions.new_session(cx);
                            sessions.send_chat(text, None, cx);
                        });
                    }
                }
            }
            ClientEvent::Disconnected => self.conn.update(cx, |conn, cx| {
                conn.set_status(ConnectionStatus::Disconnected, cx)
            }),
            ClientEvent::Response(response) => {
                use sam_protocol::AppResponse;
                match &response {
                    _ if response.conversation_id().is_some() => {
                        // Window backgrounded and a turn (active or background)
                        // just finished → desktop notification with a preview.
                        // Read before handle_stream_response clears the turn.
                        if !self.window_active {
                            if let AppResponse::TurnEnd { .. } = &response {
                                if let Some(conv) = response.conversation_id() {
                                    let sessions = self.sessions.read(cx);
                                    if let Some(preview) = sessions.turn_preview(conv) {
                                        let name = sessions
                                            .sessions
                                            .iter()
                                            .find(|s| s.conversation_id == conv)
                                            .and_then(|s| {
                                                s.name.clone().filter(|n| !n.is_empty())
                                            });
                                        let title = match name {
                                            Some(n) => format!("Sam · {n}"),
                                            None => "Sam".to_string(),
                                        };
                                        crate::notify::notify(&title, &preview);
                                    }
                                }
                            }
                        }
                        self.sessions.update(cx, |sessions, cx| {
                            sessions.handle_stream_response(response, cx)
                        });
                    }
                    AppResponse::ArtifactsChanged { path, .. } => {
                        let path = path.clone();
                        self.artifact_panel
                            .update(cx, |panel, cx| panel.refresh_if_open(&path, cx));
                    }
                    other => log::debug!("unhandled response: {other:?}"),
                }
            }
        }
    }

    /// Cmd+N: fresh conversation, jumping back to the chat page if needed.
    fn new_session(&mut self, cx: &mut Context<Self>) {
        self.sessions
            .update(cx, |sessions, cx| sessions.new_session(cx));
        self.page = Page::Chat;
        cx.notify();
    }

    fn toggle_settings(&mut self, cx: &mut Context<Self>) {
        self.page = match self.page {
            Page::Chat => Page::Settings,
            Page::Settings => Page::Chat,
        };
        cx.notify();
    }

    fn render_chat_page(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let artifact_open = self.ui.read(cx).selected_artifact.is_some();
        let has_session = self.sessions.read(cx).active.is_some();
        div()
            .size_full()
            .flex()
            .flex_row()
            .min_h_0()
            .child(self.sidebar.clone())
            .child(div().flex_1().min_w_0().h_full().child(self.chat.clone()))
            // The artifact panel replaces the right sidebar when open (parity
            // with the Tauri layout).
            .when(has_session && !artifact_open, |this| {
                this.child(self.right_sidebar.clone())
            })
            .when(artifact_open, |this| {
                this.child(self.artifact_panel.clone())
            })
    }
}

impl Render for SamApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let this = cx.entity();
        let on_settings = move |_: &mut Window, cx: &mut gpui::App| {
            this.update(cx, |app, cx| app.toggle_settings(cx));
        };

        div()
            .size_full()
            .flex()
            .flex_col()
            .on_action(cx.listener(|this, _: &crate::NewSession, _, cx| this.new_session(cx)))
            .on_action(
                cx.listener(|this, _: &crate::ToggleSettings, _, cx| this.toggle_settings(cx)),
            )
            .on_action(|_: &crate::CloseWindow, window, _| window.remove_window())
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(render_titlebar(&self.conn, on_settings, cx))
            .child(div().flex_1().min_h_0().map(|el| match self.page {
                Page::Settings => el.child(self.settings_form.clone()),
                Page::Chat => el.child(self.render_chat_page(cx)),
            }))
    }
}
