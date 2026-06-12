//! Audio playback for voice messages in history, via rodio: play/stop, a
//! shared seek slider (only the playing clip shows it), elapsed/total time.
//! Clips download once to a temp file. One clip plays at a time.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use gpui::{AnyWindowHandle, App, AppContext, Context, Entity, Global};
use gpui_component::slider::{SliderEvent, SliderState, SliderValue};
use rodio::Source;

use crate::state::ConnectionState;

pub struct AudioPlayer {
    conn: Entity<ConnectionState>,
    /// Seek bar shared by whichever clip is playing.
    slider: Entity<SliderState>,
    window: AnyWindowHandle,
    /// url-path → downloaded temp file.
    downloads: HashMap<String, PathBuf>,
    /// Kept alive for the duration of playback (drop stops audio).
    output: Option<(rodio::OutputStream, rodio::OutputStreamHandle)>,
    playing: Option<Playing>,
    /// Download in flight for this url-path.
    loading: Option<String>,
}

struct Playing {
    url: String,
    sink: rodio::Sink,
    total: Option<Duration>,
}

pub struct AudioPlayerGlobal(pub Entity<AudioPlayer>);
impl Global for AudioPlayerGlobal {}

#[derive(Clone, Copy, PartialEq)]
pub enum ClipState {
    Idle,
    Loading,
    Playing {
        pos: Duration,
        total: Option<Duration>,
    },
}

/// Current state of a clip, for rendering (reaps a finished sink).
pub fn clip_state(url: &str, cx: &mut App) -> ClipState {
    let Some(player) = cx.try_global::<AudioPlayerGlobal>().map(|g| g.0.clone()) else {
        return ClipState::Idle;
    };
    let url = url.to_string();
    player.update(cx, |player, _| {
        player.reap();
        if player.loading.as_deref() == Some(url.as_str()) {
            ClipState::Loading
        } else {
            match &player.playing {
                Some(p) if p.url == url => ClipState::Playing {
                    pos: p.sink.get_pos(),
                    total: p.total,
                },
                _ => ClipState::Idle,
            }
        }
    })
}

/// The shared seek slider, for rendering next to the playing clip.
pub fn seek_slider(cx: &App) -> Option<Entity<SliderState>> {
    Some(
        cx.try_global::<AudioPlayerGlobal>()?
            .0
            .read(cx)
            .slider
            .clone(),
    )
}

/// Toggle playback of a clip (stops whatever else is playing).
pub fn toggle(url: &str, cx: &mut App) {
    let Some(player) = cx.try_global::<AudioPlayerGlobal>().map(|g| g.0.clone()) else {
        return;
    };
    let url = url.to_string();
    player.update(cx, |player, cx| player.toggle(url, cx));
}

pub fn format_time(d: Duration) -> String {
    let s = d.as_secs();
    format!("{}:{:02}", s / 60, s % 60)
}

impl AudioPlayer {
    pub fn new(
        conn: Entity<ConnectionState>,
        window: AnyWindowHandle,
        cx: &mut Context<Self>,
    ) -> Self {
        let slider = cx.new(|_| SliderState::new().min(0.).max(1.).step(0.001));
        // Dragging the slider scrubs the playing clip. Programmatic
        // set_value (the progress poll) does not emit Change, so no loop.
        cx.subscribe(&slider, |this: &mut Self, _, event, _| {
            let SliderEvent::Change(SliderValue::Single(fraction)) = event else {
                return;
            };
            if let Some(p) = &this.playing {
                if let Some(total) = p.total {
                    let _ = p.sink.try_seek(total.mul_f32(fraction.clamp(0., 1.)));
                }
            }
        })
        .detach();

        Self {
            conn,
            slider,
            window,
            downloads: HashMap::new(),
            output: None,
            playing: None,
            loading: None,
        }
    }

    /// Clear `playing` once the sink has drained.
    fn reap(&mut self) {
        if self.playing.as_ref().is_some_and(|p| p.sink.empty()) {
            self.playing = None;
        }
    }

    fn stop(&mut self) {
        if let Some(p) = self.playing.take() {
            p.sink.stop();
        }
    }

    fn toggle(&mut self, url: String, cx: &mut Context<Self>) {
        self.reap();
        if self.playing.as_ref().is_some_and(|p| p.url == url) {
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

    fn ensure_output(&mut self) -> Option<&rodio::OutputStreamHandle> {
        if self.output.is_none() {
            match rodio::OutputStream::try_default() {
                Ok(output) => self.output = Some(output),
                Err(e) => {
                    log::warn!("audio output unavailable: {e}");
                    return None;
                }
            }
        }
        self.output.as_ref().map(|(_, handle)| handle)
    }

    fn play_file(&mut self, url: String, path: PathBuf, cx: &mut Context<Self>) {
        let Some(handle) = self.ensure_output() else {
            return;
        };
        let source = match std::fs::File::open(&path)
            .map_err(|e| e.to_string())
            .and_then(|f| {
                rodio::Decoder::new(std::io::BufReader::new(f))
                    .map_err(|e: rodio::decoder::DecoderError| e.to_string())
            }) {
            Ok(source) => source,
            Err(e) => {
                log::warn!("audio decode failed: {e}");
                return;
            }
        };
        let total = source.total_duration();
        let sink = match rodio::Sink::try_new(handle) {
            Ok(sink) => sink,
            Err(e) => {
                log::warn!("audio sink failed: {e}");
                return;
            }
        };
        sink.append(source);
        self.playing = Some(Playing { url, sink, total });

        // Progress poll: drives the seek slider and the elapsed label, and
        // flips the chip back when the clip drains.
        let window = self.window;
        let slider = self.slider.clone();
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(300))
                    .await;
                let Ok(state) = this.update(cx, |this, cx| {
                    this.reap();
                    let state = this.playing.as_ref().map(|p| (p.sink.get_pos(), p.total));
                    cx.notify(); // refresh elapsed label / chip state
                    state
                }) else {
                    break;
                };
                let Some((pos, total)) = state else {
                    break; // drained or stopped
                };
                if let Some(total) = total.filter(|t| !t.is_zero()) {
                    let fraction = (pos.as_secs_f32() / total.as_secs_f32()).clamp(0., 1.);
                    window
                        .update(cx, |_, window, cx| {
                            slider.update(cx, |s, cx| {
                                s.set_value(SliderValue::Single(fraction), window, cx)
                            });
                        })
                        .ok();
                }
            }
        })
        .detach();
    }
}

impl Drop for AudioPlayer {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal 16-bit mono PCM WAV: `secs` seconds of silence at 22050 Hz.
    fn wav_bytes(secs: u32) -> Vec<u8> {
        let rate: u32 = 22050;
        let samples = rate * secs;
        let data_len = samples * 2;
        let mut out = Vec::with_capacity(44 + data_len as usize);
        out.extend(b"RIFF");
        out.extend((36 + data_len).to_le_bytes());
        out.extend(b"WAVEfmt ");
        out.extend(16u32.to_le_bytes());
        out.extend(1u16.to_le_bytes()); // PCM
        out.extend(1u16.to_le_bytes()); // mono
        out.extend(rate.to_le_bytes());
        out.extend((rate * 2).to_le_bytes()); // byte rate
        out.extend(2u16.to_le_bytes()); // block align
        out.extend(16u16.to_le_bytes()); // bits per sample
        out.extend(b"data");
        out.extend(data_len.to_le_bytes());
        out.resize(44 + data_len as usize, 0);
        out
    }

    #[test]
    fn decoder_reports_wav_duration() {
        let bytes = wav_bytes(3);
        let source = rodio::Decoder::new(std::io::Cursor::new(bytes)).unwrap();
        let total = source.total_duration().expect("wav should have duration");
        assert!((total.as_secs_f32() - 3.0).abs() < 0.05, "got {total:?}");
    }

    #[test]
    fn time_formatting() {
        assert_eq!(format_time(Duration::from_secs(0)), "0:00");
        assert_eq!(format_time(Duration::from_secs(65)), "1:05");
        assert_eq!(format_time(Duration::from_secs(600)), "10:00");
    }
}
