//! macOS user notifications.
//!
//! Bundled (Sam.app): delivered through NSUserNotificationCenter attributed
//! to our bundle id — clicking the notification focuses the app.
//! Bare dev binary: `osascript` fallback (no bundle identity, click is inert).

/// Fire-and-forget desktop notification.
pub fn notify(title: &str, message: &str) {
    log::info!("posting notification: {message:.40}");

    #[cfg(target_os = "macos")]
    if running_from_bundle() {
        use std::sync::Once;
        static SET_APP: Once = Once::new();
        SET_APP.call_once(|| {
            if let Err(e) = mac_notification_sys::set_application("com.offbeatengineer.sam-gpui") {
                log::warn!("set_application failed (using main bundle): {e}");
            }
        });
        let mut options = mac_notification_sys::Notification::new();
        options.asynchronous(true);
        match mac_notification_sys::send_notification(title, None, message, Some(&options)) {
            Ok(_) => return,
            Err(e) => log::warn!("bundle notification failed, falling back: {e}"),
        }
    }

    // The message is passed as an argv item (never interpolated into the
    // script), so no escaping is needed.
    let result = std::process::Command::new("osascript")
        .arg("-e")
        .arg("on run argv")
        .arg("-e")
        .arg("display notification (item 1 of argv) with title (item 2 of argv)")
        .arg("-e")
        .arg("end run")
        .arg(message)
        .arg(title)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    if let Err(e) = result {
        log::warn!("failed to post notification: {e}");
    }
}

/// True when the executable lives inside a .app bundle (Contents/MacOS).
#[cfg(target_os = "macos")]
fn running_from_bundle() -> bool {
    std::env::current_exe().is_ok_and(|exe| {
        exe.components()
            .any(|c| c.as_os_str().to_str().is_some_and(|s| s.ends_with(".app")))
    })
}
