//! Instance settings form. Serves as both the first-launch startup screen and
//! the settings page in M1. (Multi-instance management arrives in M6.)

use gpui::{
    div, prelude::*, px, Context, Entity, EventEmitter, SharedString, Window,
};
use gpui_component::{
    button::{Button, ButtonVariants},
    input::{Input, InputState},
    ActiveTheme, StyledExt,
};

use crate::settings::{BackendInstance, DEFAULT_SAM_URL};
use crate::state::ConnectionState;

pub enum SettingsFormEvent {
    Saved,
}

pub struct SettingsForm {
    conn: Entity<ConnectionState>,
    name_input: Entity<InputState>,
    url_input: Entity<InputState>,
    key_input: Entity<InputState>,
    /// Id of the instance being edited (None → creating the first one).
    editing_id: Option<String>,
    error: Option<SharedString>,
}

impl EventEmitter<SettingsFormEvent> for SettingsForm {}

impl SettingsForm {
    pub fn new(
        conn: Entity<ConnectionState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let active = conn.read(cx).active_instance().cloned();
        let (name, url, key, editing_id) = match &active {
            Some(i) => (
                i.name.clone(),
                i.server_url.clone(),
                i.api_key.clone().unwrap_or_default(),
                Some(i.id.clone()),
            ),
            None => ("Default".to_string(), DEFAULT_SAM_URL.to_string(), String::new(), None),
        };

        let name_input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("Instance name")
                .default_value(name)
        });
        let url_input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(DEFAULT_SAM_URL)
                .default_value(url)
        });
        let key_input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("Optional API key")
                .default_value(key)
        });

        Self {
            conn,
            name_input,
            url_input,
            key_input,
            editing_id,
            error: None,
        }
    }

    fn save(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let name = self.name_input.read(cx).value().trim().to_string();
        let url = self.url_input.read(cx).value().trim().to_string();
        let key = self.key_input.read(cx).value().trim().to_string();

        if url.is_empty() || !(url.starts_with("ws://") || url.starts_with("wss://")) {
            self.error = Some("Server URL must start with ws:// or wss://".into());
            cx.notify();
            return;
        }
        self.error = None;

        let mut instance = BackendInstance::new(
            if name.is_empty() { "Default".to_string() } else { name },
            url,
            (!key.is_empty()).then_some(key),
        );
        if let Some(id) = &self.editing_id {
            instance.id = id.clone();
        }
        self.editing_id = Some(instance.id.clone());

        self.conn.update(cx, |conn, cx| {
            conn.save_and_connect_instance(instance, cx);
        });
        cx.emit(SettingsFormEvent::Saved);
    }
}

impl Render for SettingsForm {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let field = |label: &'static str, input: &Entity<InputState>| {
            div()
                .flex()
                .flex_col()
                .gap_1()
                .child(
                    div()
                        .text_xs()
                        .text_color(cx.theme().muted_foreground)
                        .child(label),
                )
                .child(Input::new(input))
        };

        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(cx.theme().background)
            .child(
                div()
                    .w(px(420.))
                    .flex()
                    .flex_col()
                    .gap_4()
                    .p_6()
                    .rounded_lg()
                    .border_1()
                    .border_color(cx.theme().border)
                    .child(
                        div()
                            .text_lg()
                            .font_semibold()
                            .child("Connect to Sam"),
                    )
                    .child(
                        div()
                            .text_sm()
                            .text_color(cx.theme().muted_foreground)
                            .child("Sam agent must be running (see agent/README.md). Default: ws://127.0.0.1:9222"),
                    )
                    .child(field("Name", &self.name_input))
                    .child(field("Server URL", &self.url_input))
                    .child(field("API key", &self.key_input))
                    .when_some(self.error.clone(), |this, error| {
                        this.child(
                            div()
                                .text_sm()
                                .text_color(cx.theme().danger)
                                .child(error),
                        )
                    })
                    .child(
                        Button::new("save-connect")
                            .primary()
                            .label("Save & Connect")
                            .on_click(cx.listener(|this, _, window, cx| this.save(window, cx))),
                    ),
            )
    }
}
