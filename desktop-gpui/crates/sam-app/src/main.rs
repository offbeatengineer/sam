mod app;
mod attachments;
mod markdown;
mod settings;
mod state;
mod views;

use app::SamApp;
use gpui::{px, size, App, AppContext, Application, Bounds, WindowBounds, WindowOptions};
use gpui_component::{Root, TitleBar};

fn main() {
    env_logger::init();

    Application::new().run(|cx: &mut App| {
        gpui_component::init(cx);

        // Shift+Enter in the composer inserts a newline without sending: it
        // triggers the input's Enter action with secondary=true, which the
        // composer ignores (plain Enter sends).
        cx.bind_keys([gpui::KeyBinding::new(
            "shift-enter",
            gpui_component::input::Enter { secondary: true },
            Some("Input"),
        )]);

        let bounds = Bounds::centered(None, size(px(1200.), px(800.)), cx);
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            titlebar: Some(TitleBar::title_bar_options()),
            window_min_size: Some(size(px(900.), px(600.))),
            ..Default::default()
        };

        cx.open_window(options, |window, cx| {
            let view = cx.new(|cx| SamApp::new(window, cx));
            cx.new(|cx| Root::new(view, window, cx))
        })
        .expect("failed to open window");

        cx.activate(true);
    });
}
