//! App title bar: drag region, connection status dot, settings toggle.

use gpui::{div, prelude::*, px, App, Entity, SharedString, Window};
use gpui_component::{
    button::Button, button::ButtonVariants, ActiveTheme, IconName, Sizable, TitleBar,
};

use crate::state::{ConnectionState, ConnectionStatus};

pub fn render_titlebar(
    conn: &Entity<ConnectionState>,
    on_settings: impl Fn(&mut Window, &mut App) + 'static,
    cx: &mut App,
) -> impl IntoElement {
    let (status, instance_name) = {
        let conn = conn.read(cx);
        (
            conn.status,
            conn.active_instance()
                .map(|i| i.name.clone())
                .unwrap_or_else(|| "Not configured".into()),
        )
    };

    let (dot_color, status_label) = match status {
        ConnectionStatus::Connected => (cx.theme().success, "Connected"),
        ConnectionStatus::Connecting => (cx.theme().warning, "Connecting…"),
        ConnectionStatus::Disconnected => (cx.theme().danger, "Disconnected"),
    };

    TitleBar::new()
        .child(
            div()
                .flex()
                .flex_row()
                .items_center()
                .gap_2()
                .child(SharedString::from("Sam"))
                .child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap_1p5()
                        .px_2()
                        .py_0p5()
                        .rounded_md()
                        .text_xs()
                        .text_color(cx.theme().muted_foreground)
                        .child(div().size(px(8.)).rounded_full().bg(dot_color))
                        .child(format!("{instance_name} · {status_label}")),
                ),
        )
        .child(
            div().flex().flex_row().justify_end().flex_1().pr_2().child(
                Button::new("open-settings")
                    .icon(IconName::Settings)
                    .ghost()
                    .small()
                    .on_click(move |_, window, cx| on_settings(window, cx)),
            ),
        )
}
