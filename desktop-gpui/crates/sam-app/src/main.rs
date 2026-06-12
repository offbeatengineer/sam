mod app;
mod attachments;
mod markdown;
mod notify;
mod settings;
mod state;
mod views;

use app::SamApp;
use gpui::{
    px, size, App, AppContext, Application, Bounds, Menu, MenuItem, OsAction, SystemMenuType,
    WindowBounds, WindowOptions,
};
use gpui_component::{input, Root, TitleBar};

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

            // Standard macOS menu bar. The Edit items route to the focused
            // input via gpui-component's input actions; the OsAction tags let
            // AppKit special-case them (e.g. in NSTextField dialogs).
            cx.set_menus(vec![
                Menu {
                    name: "Sam".into(),
                    items: vec![
                        MenuItem::action("Settings…", ToggleSettings),
                        MenuItem::separator(),
                        MenuItem::os_submenu("Services", SystemMenuType::Services),
                        MenuItem::separator(),
                        MenuItem::action("Quit Sam", Quit),
                    ],
                },
                Menu {
                    name: "Session".into(),
                    items: vec![MenuItem::action("New Session", NewSession)],
                },
                Menu {
                    name: "Edit".into(),
                    items: vec![
                        MenuItem::os_action("Undo", input::Undo, OsAction::Undo),
                        MenuItem::os_action("Redo", input::Redo, OsAction::Redo),
                        MenuItem::separator(),
                        MenuItem::os_action("Cut", input::Cut, OsAction::Cut),
                        MenuItem::os_action("Copy", input::Copy, OsAction::Copy),
                        MenuItem::os_action("Paste", input::Paste, OsAction::Paste),
                        MenuItem::os_action("Select All", input::SelectAll, OsAction::SelectAll),
                    ],
                },
                Menu {
                    name: "Window".into(),
                    items: vec![MenuItem::action("Close Window", CloseWindow)],
                },
            ]);

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
