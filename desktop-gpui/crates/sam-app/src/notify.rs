//! macOS user notifications. The bare dev binary has no bundle identity, so
//! we go through `osascript` (`display notification`) instead of a native
//! notification framework — revisit when the app ships as a proper .app
//! bundle (M6 packaging).

/// Fire-and-forget desktop notification. The message is passed as an argv
/// item (never interpolated into the script), so no escaping is needed.
pub fn notify(title: &str, message: &str) {
    log::info!("posting notification: {message:.40}");
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
