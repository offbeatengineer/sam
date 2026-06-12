//! Minimal audio playback for voice messages in history: download the
//! upload ref to a temp file and play it with `afplay` (macOS built-in).
//! One clip at a time; clicking a playing chip stops it. (The Tauri client
//! uses an HTML <audio> element; a native seek/scrub UI can come later.)

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;
use std::time::Duration;

use gpui::{App, Context, Entity, Global};

use crate::state::ConnectionState;

pub struct AudioPlayer {
    conn: Entity<ConnectionState>,
    /// url-path → downloaded temp file (downloads are keyed by source path).
    downloads: HashMap<String, PathBuf>,
    /// Currently playing (url-path, afplay process).
    playing: Option<(String, Child)>,
    /// Download in flight for this url-path.
    loading: Option<String>,
}

pub struct AudioPlayerGlobal(pub Entity<AudioPlayer>);
impl Global for AudioPlayerGlobal {}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PlayState {
    Idle,
    Loading,
    Playing,
}

/// Current state of a clip, for rendering (reaps a finished afplay).
pub fn play_state(url: &str, cx: &mut App) -> PlayState {
    let Some(player) = cx.try_global::<AudioPlayerGlobal>().map(|g| g.0.clone()) else {
        return PlayState::Idle;
    };
    let url = url.to_string();
    player.update(cx, |player, _| {
        player.reap();
        if player.loading.as_deref() == Some(url.as_str()) {
            PlayState::Loading
        } else if player.playing.as_ref().is_some_and(|(u, _)| *u == url) {
            PlayState::Playing
        } else {
            PlayState::Idle
        }
    })
}

/// Toggle playback of a clip (stops whatever else is playing).
pub fn toggle(url: &str, cx: &mut App) {
    let Some(player) = cx.try_global::<AudioPlayerGlobal>().map(|g| g.0.clone()) else {
        return;
    };
    let url = url.to_string();
    player.update(cx, |player, cx| player.toggle(url, cx));
}

impl AudioPlayer {
    pub fn new(conn: Entity<ConnectionState>) -> Self {
        Self {
            conn,
            downloads: HashMap::new(),
            playing: None,
            loading: None,
        }
    }

    /// Clear `playing` if afplay already exited on its own.
    fn reap(&mut self) {
        if let Some((_, child)) = &mut self.playing {
            if matches!(child.try_wait(), Ok(Some(_)) | Err(_)) {
                self.playing = None;
            }
        }
    }

    fn stop(&mut self) {
        if let Some((_, mut child)) = self.playing.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn toggle(&mut self, url: String, cx: &mut Context<Self>) {
        self.reap();
        if self.playing.as_ref().is_some_and(|(u, _)| *u == url) {
            self.stop();
            cx.notify();
            return;
        }
        self.stop();

        if let Some(path) = self.downloads.get(&url).filter(|p| p.exists()).cloned() {
            self.play_file(url, path, cx);
            cx.notify();
            return;
        }

        let conn = self.conn.read(cx);
        let Some(full) = conn.upload_url(&url) else {
            return;
        };
        let fetch = conn.client.fetch_bytes(full, None);
        self.loading = Some(url.clone());
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = fetch.await;
            this.update(cx, |this, cx| {
                if this.loading.as_deref() != Some(url.as_str()) {
                    return; // user toggled something else meanwhile
                }
                this.loading = None;
                match result {
                    Ok(bytes) => {
                        let ext = url.rsplit('.').next().unwrap_or("wav").to_string();
                        let path = std::env::temp_dir()
                            .join(format!("sam_audio_{}.{ext}", uuid::Uuid::new_v4()));
                        if std::fs::write(&path, bytes).is_ok() {
                            this.downloads.insert(url.clone(), path.clone());
                            this.play_file(url, path, cx);
                        }
                    }
                    Err(e) => log::warn!("audio download failed: {e}"),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn play_file(&mut self, url: String, path: PathBuf, cx: &mut Context<Self>) {
        match std::process::Command::new("afplay").arg(&path).spawn() {
            Ok(child) => {
                self.playing = Some((url, child));
                // Flip the chip back when afplay finishes on its own.
                cx.spawn(async move |this, cx| loop {
                    cx.background_executor()
                        .timer(Duration::from_millis(500))
                        .await;
                    let done = this
                        .update(cx, |this, cx| {
                            this.reap();
                            if this.playing.is_none() {
                                cx.notify();
                                true
                            } else {
                                false
                            }
                        })
                        .unwrap_or(true);
                    if done {
                        break;
                    }
                })
                .detach();
            }
            Err(e) => log::warn!("afplay failed: {e}"),
        }
    }
}

impl Drop for AudioPlayer {
    fn drop(&mut self) {
        self.stop();
    }
}
