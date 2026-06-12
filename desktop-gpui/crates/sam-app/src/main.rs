mod app;
mod attachments;
mod markdown;
mod notify;
mod settings;
mod state;
mod views;

use app::SamApp;
use gpui::{px, size, App, AppContext, Application, Bounds, WindowBounds, WindowOptions};
use gpui_component::{Root, TitleBar};

gpui::actions!(sam, [NewSession, ToggleSettings, CloseWindow, Quit]);

fn main() {
    env_logger::init();

    // IconName SVGs resolve through the app's AssetSource; without this every
    // icon in the app (and inside gpui-component widgets) renders blank.
    Application::new()
        .with_assets(gpui_component_assets::Assets)
        .run(|cx: &mut App| {
            gpui_component::init(cx);

            // Shift+Enter in the composer inserts a newline without sending: it
            // triggers the input's Enter action with secondary=true, which the
            // composer ignores (plain Enter sends).
            cx.bind_keys([
                gpui::KeyBinding::new(
                    "shift-enter",
                    gpui_component::input::Enter { secondary: true },
                    Some("Input"),
                ),
                gpui::KeyBinding::new("cmd-n", NewSession, None),
                gpui::KeyBinding::new("cmd-,", ToggleSettings, None),
                gpui::KeyBinding::new("cmd-w", CloseWindow, None),
                gpui::KeyBinding::new("cmd-q", Quit, None),
            ]);

            cx.on_action(|_: &Quit, cx| cx.quit());

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
