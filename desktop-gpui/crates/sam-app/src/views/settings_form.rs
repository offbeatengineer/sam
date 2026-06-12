//! Settings page: backend instance list (switch/edit/remove) plus the
//! add/edit form. Doubles as the first-launch startup screen when no
//! instance exists yet. Port of the instance management in
//! `desktop/src/stores/settingsStore.ts` + its settings UI.

use gpui::{div, prelude::*, px, Context, Entity, EventEmitter, SharedString, Window};
use gpui_component::{
    button::{Button, ButtonVariants},
    input::{Input, InputState},
    ActiveTheme, IconName, Sizable, StyledExt,
};

use crate::settings::{BackendInstance, DEFAULT_SAM_URL};
use crate::state::ConnectionState;

pub enum SettingsFormEvent {
    /// Instance saved → back to chat.
    Saved,
    /// Active instance switched → clear per-instance stores, back to chat.
    SwitchedInstance,
    /// The active instance was removed → clear per-instance stores.
    ActiveInstanceRemoved,
}

pub struct SettingsForm {
    conn: Entity<ConnectionState>,
    name_input: Entity<InputState>,
    url_input: Entity<InputState>,
    key_input: Entity<InputState>,
    /// Id of the instance being edited (None → creating a new one).
    editing_id: Option<String>,
    error: Option<SharedString>,
}

impl EventEmitter<SettingsFormEvent> for SettingsForm {}

impl SettingsForm {
    pub fn new(conn: Entity<ConnectionState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        cx.observe(&conn, |_, _, cx| cx.notify()).detach();

        let active = conn.read(cx).active_instance().cloned();
        let (name, url, key, editing_id) = match &active {
            Some(i) => (
                i.name.clone(),
                i.server_url.clone(),
                i.api_key.clone().unwrap_or_default(),
                Some(i.id.clone()),
            ),
            None => (
                "Default".to_string(),
                DEFAULT_SAM_URL.to_string(),
                String::new(),
                None,
            ),
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

    fn fill_form(
        &mut self,
        instance: Option<&BackendInstance>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (name, url, key, id) = match instance {
            Some(i) => (
                i.name.clone(),
                i.server_url.clone(),
                i.api_key.clone().unwrap_or_default(),
                Some(i.id.clone()),
            ),
            None => (
                String::new(),
                DEFAULT_SAM_URL.to_string(),
                String::new(),
                None,
            ),
        };
        self.name_input
            .update(cx, |s, cx| s.set_value(name, window, cx));
        self.url_input
            .update(cx, |s, cx| s.set_value(url, window, cx));
        self.key_input
            .update(cx, |s, cx| s.set_value(key, window, cx));
        self.editing_id = id;
        self.error = None;
        cx.notify();
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
            if name.is_empty() {
                "Default".to_string()
            } else {
                name
            },
            url,
            (!key.is_empty()).then_some(key),
        );
        if let Some(id) = &self.editing_id {
            instance.id = id.clone();
        }
        self.editing_id = Some(instance.id.clone());

        self.conn
            .update(cx, |conn, cx| conn.save_instance(instance, cx));
        cx.emit(SettingsFormEvent::Saved);
    }

    fn switch(&mut self, id: &str, cx: &mut Context<Self>) {
        let switched = self
            .conn
            .update(cx, |conn, cx| conn.switch_instance(id, cx));
        if switched {
            cx.emit(SettingsFormEvent::SwitchedInstance);
        }
    }

    fn remove(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let active_changed = self
            .conn
            .update(cx, |conn, cx| conn.remove_instance(id, cx));
        if self.editing_id.as_deref() == Some(id) {
            let next = self.conn.read(cx).active_instance().cloned();
            self.fill_form(next.as_ref(), window, cx);
        }
        if active_changed {
            cx.emit(SettingsFormEvent::ActiveInstanceRemoved);
        }
        cx.notify();
    }

    fn render_instance_row(
        &self,
        ix: usize,
        instance: &BackendInstance,
        is_active: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let id = instance.id.clone();
        let id_for_remove = id.clone();
        let instance_for_edit = instance.clone();
        let is_editing = self.editing_id.as_deref() == Some(instance.id.as_str());

        div()
            .flex()
            .flex_row()
            .items_center()
            .gap_2()
            .px_3()
            .py_2()
            .rounded_md()
            .border_1()
            .border_color(if is_editing {
                cx.theme().primary
            } else {
                cx.theme().border
            })
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .flex()
                            .flex_row()
                            .items_center()
                            .gap_1p5()
                            .child(div().text_sm().font_semibold().child(instance.name.clone()))
                            .when(is_active, |this| {
                                this.child(
                                    div()
                                        .text_xs()
                                        .text_color(cx.theme().success)
                                        .child("● active"),
                                )
                            }),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .truncate()
                            .child(instance.server_url.clone()),
                    ),
            )
            .when(!is_active, |this| {
                this.child(
                    Button::new(("switch", ix))
                        .label("Connect")
                        .small()
                        .on_click(cx.listener(move |this, _, _, cx| this.switch(&id, cx))),
                )
            })
            .child(
                Button::new(("edit", ix))
                    .label("Edit")
                    .ghost()
                    .small()
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.fill_form(Some(&instance_for_edit), window, cx)
                    })),
            )
            .child(
                Button::new(("remove", ix))
                    .icon(IconName::Close)
                    .ghost()
                    .small()
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.remove(&id_for_remove, window, cx)
                    })),
            )
    }
}

impl Render for SettingsForm {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let instances = self.conn.read(cx).settings.instances.clone();
        let active_id = self.conn.read(cx).settings.active_instance_id.clone();
        let first_launch = instances.is_empty();

        let rows = instances
            .iter()
            .enumerate()
            .map(|(ix, instance)| {
                let is_active = active_id.as_deref() == Some(instance.id.as_str());
                self.render_instance_row(ix, instance, is_active, cx)
                    .into_any_element()
            })
            .collect::<Vec<_>>();

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
                    .w(px(480.))
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
                            .child(if first_launch { "Connect to Sam" } else { "Instances" }),
                    )
                    .when(first_launch, |this| {
                        this.child(
                            div()
                                .text_sm()
                                .text_color(cx.theme().muted_foreground)
                                .child("Sam agent must be running (see agent/README.md). Default: ws://127.0.0.1:9222"),
                        )
                    })
                    .when(!first_launch, |this| {
                        this.child(div().flex().flex_col().gap_2().children(rows))
                            .child(
                                div().flex().flex_row().justify_end().child(
                                    Button::new("new-instance")
                                        .icon(IconName::Plus)
                                        .label("New instance")
                                        .ghost()
                                        .small()
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.fill_form(None, window, cx)
                                        })),
                                ),
                            )
                            .child(div().h(px(1.)).bg(cx.theme().border))
                            .child(
                                div()
                                    .text_sm()
                                    .font_semibold()
                                    .child(if self.editing_id.is_some() {
                                        "Edit instance"
                                    } else {
                                        "Add instance"
                                    }),
                            )
                    })
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
                            .label(if first_launch { "Save & Connect" } else { "Save" })
                            .on_click(cx.listener(|this, _, window, cx| this.save(window, cx))),
                    ),
            )
    }
}
