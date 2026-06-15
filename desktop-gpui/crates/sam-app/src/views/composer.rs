//! Message composer: auto-growing input, Enter to send (Shift+Enter newline,
//! bound in main.rs), image attachments (picker + drag-drop), audio
//! recording, abort while streaming.

use std::path::PathBuf;

use gpui::{
    div, prelude::*, px, Context, Entity, ExternalPaths, Global, PathPromptOptions, SharedString,
    Subscription, Window,
};
use gpui_component::{
    button::{Button, ButtonVariants},
    input::{Input, InputEvent, InputState},
    ActiveTheme, Icon, IconName, Sizable, StyledExt,
};
use sam_client::RecordingResult;
use sam_protocol::{AttachmentKind, ChatAttachment};

use crate::attachments::{is_image_path, prepare_image, MAX_IMAGES};
use crate::state::sessions::SessionStore;
use crate::state::ConnectionState;

/// A staged image: already resized/re-encoded, sitting in a temp file.
struct PendingImage {
    original_name: String,
    temp_path: PathBuf,
}

/// The composer's text input, exposed globally so the right-sidebar file tree
/// can insert `@path` references into it.
pub struct ComposerInputGlobal(pub Entity<InputState>);

impl Global for ComposerInputGlobal {}

pub struct Composer {
    store: Entity<SessionStore>,
    conn: Entity<ConnectionState>,
    input: Entity<InputState>,
    pending_images: Vec<PendingImage>,
    pending_audio: Option<RecordingResult>,
    recording: bool,
    sending: bool,
    error: Option<SharedString>,
    _subscriptions: Vec<Subscription>,
}

impl Composer {
    pub fn new(
        store: Entity<SessionStore>,
        conn: Entity<ConnectionState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let input = cx.new(|cx| {
            InputState::new(window, cx)
                .multi_line(true)
                .auto_grow(1, 8)
                .placeholder("Message Sam — Enter to send, Shift+Enter for newline")
        });
        // Expose the input so the right-sidebar file tree can insert @path refs.
        cx.set_global(ComposerInputGlobal(input.clone()));

        let subscription = cx.subscribe_in(
            &input,
            window,
            |this: &mut Self, _, event: &InputEvent, window, cx| {
                if let InputEvent::PressEnter { secondary } = event {
                    if !secondary {
                        this.send(window, cx);
                    }
                }
            },
        );

        cx.observe(&store, |_, _, cx| cx.notify()).detach();

        Self {
            store,
            conn,
            input,
            pending_images: Vec::new(),
            pending_audio: None,
            recording: false,
            sending: false,
            error: None,
            _subscriptions: vec![subscription],
        }
    }

    pub fn add_image_paths(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        for path in paths {
            if !is_image_path(&path) {
                continue;
            }
            if self.pending_images.len() >= MAX_IMAGES {
                self.error = Some(format!("At most {MAX_IMAGES} images per message").into());
                break;
            }
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "image".into());
            // Reserve the slot synchronously (cap check), fill in when ready.
            let placeholder = PathBuf::new();
            self.pending_images.push(PendingImage {
                original_name: name.clone(),
                temp_path: placeholder,
            });
            let slot = self.pending_images.len() - 1;
            let task = cx.background_executor().spawn({
                let path = path.clone();
                async move { prepare_image(&path) }
            });
            cx.spawn(async move |this, cx| {
                let result = task.await;
                this.update(cx, |this, cx| {
                    match result {
                        Ok(temp_path) => {
                            if let Some(slot) = this.pending_images.get_mut(slot) {
                                slot.temp_path = temp_path;
                            }
                        }
                        Err(e) => {
                            log::warn!("image prepare failed: {e}");
                            this.error = Some(format!("Couldn't read image: {e}").into());
                            this.pending_images.retain(|p| p.original_name != name);
                        }
                    }
                    cx.notify();
                })
                .ok();
            })
            .detach();
        }
        cx.notify();
    }

    /// Cmd+V with an image on the clipboard stages it as an attachment
    /// instead of pasting text (intercepted in the capture phase, before the
    /// Input's own Paste handler runs — see render()). Returns false when
    /// the clipboard holds no image, letting the text paste proceed.
    fn paste_clipboard_image(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(item) = cx.read_from_clipboard() else {
            return false;
        };
        let mut staged = Vec::new();
        for entry in item.entries() {
            if let gpui::ClipboardEntry::Image(image) = entry {
                let ext = match image.format {
                    gpui::ImageFormat::Png => "png",
                    gpui::ImageFormat::Jpeg => "jpg",
                    gpui::ImageFormat::Webp => "webp",
                    gpui::ImageFormat::Gif => "gif",
                    gpui::ImageFormat::Bmp => "bmp",
                    gpui::ImageFormat::Tiff => "tiff",
                    _ => continue,
                };
                let short = uuid::Uuid::new_v4().to_string()[..8].to_string();
                let path = std::env::temp_dir().join(format!("pasted-{short}.{ext}"));
                match std::fs::write(&path, &image.bytes) {
                    Ok(()) => staged.push(path),
                    Err(e) => log::warn!("failed to stage clipboard image: {e}"),
                }
            }
        }
        if staged.is_empty() {
            return false;
        }
        self.add_image_paths(staged, cx);
        true
    }

    fn pick_images(&mut self, cx: &mut Context<Self>) {
        let receiver = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: None,
        });
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(Some(paths))) = receiver.await {
                this.update(cx, |this, cx| this.add_image_paths(paths, cx))
                    .ok();
            }
        })
        .detach();
    }

    fn toggle_recording(&mut self, cx: &mut Context<Self>) {
        let client = self.store.read(cx).client();
        if self.recording {
            self.recording = false;
            let stop = client.stop_recording();
            cx.spawn(async move |this, cx| {
                let result = stop.await;
                this.update(cx, |this, cx| {
                    match result {
                        Ok(recording) => this.pending_audio = Some(recording),
                        Err(e) => this.error = Some(format!("Recording failed: {e}").into()),
                    }
                    cx.notify();
                })
                .ok();
            })
            .detach();
        } else {
            let start = client.start_recording();
            cx.spawn(async move |this, cx| {
                let result = start.await;
                this.update(cx, |this, cx| {
                    match result {
                        Ok(()) => this.recording = true,
                        Err(e) => this.error = Some(format!("Mic unavailable: {e}").into()),
                    }
                    cx.notify();
                })
                .ok();
            })
            .detach();
        }
        cx.notify();
    }

    fn send(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let store = self.store.read(cx);
        if store.streaming.is_some() || self.sending {
            return;
        }
        let text = self.input.read(cx).value().trim().to_string();
        let has_attachments = !self.pending_images.is_empty() || self.pending_audio.is_some();
        if text.is_empty() && !has_attachments {
            self.input
                .update(cx, |input, cx| input.set_value("", window, cx));
            return;
        }
        if self
            .pending_images
            .iter()
            .any(|p| p.temp_path.as_os_str().is_empty())
        {
            self.error = Some("Still processing images…".into());
            cx.notify();
            return;
        }
        self.error = None;
        self.input
            .update(cx, |input, cx| input.set_value("", window, cx));

        if !has_attachments {
            self.store
                .update(cx, |store, cx| store.send_chat(text, None, cx));
            return;
        }

        // Upload attachments first, then send the chat referencing them.
        let Some(base_url) = self.conn.read(cx).artifacts_url() else {
            self.error = Some("Not connected".into());
            cx.notify();
            return;
        };
        let upload_url = format!("{base_url}/upload");
        let api_key = self
            .conn
            .read(cx)
            .active_instance()
            .and_then(|i| i.api_key.clone());
        let client = self.store.read(cx).client();

        // Optimistic bubble: show the staged images/audio immediately. Copy
        // each resized JPEG to a preview temp (the upload deletes its own temp
        // via delete_after; SessionStore deletes these in clear_pending).
        let preview_images: Vec<PathBuf> = self
            .pending_images
            .iter()
            .filter(|p| !p.temp_path.as_os_str().is_empty())
            .filter_map(|p| {
                let dst = std::env::temp_dir()
                    .join(format!("pending-preview-{}.jpg", uuid::Uuid::new_v4()));
                std::fs::copy(&p.temp_path, &dst).ok().map(|_| dst)
            })
            .collect();
        let audio_secs = self.pending_audio.as_ref().map(|a| a.duration as f32);
        self.store.update(cx, |store, cx| {
            store.set_pending(text.clone(), preview_images, audio_secs, cx)
        });

        let images: Vec<PathBuf> = self.pending_images.drain(..).map(|p| p.temp_path).collect();
        let audio = self.pending_audio.take();
        self.sending = true;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let mut attachments: Vec<ChatAttachment> = Vec::new();
            let mut failure: Option<String> = None;

            for path in images {
                let upload = client.upload_file(
                    path.to_string_lossy().to_string(),
                    upload_url.clone(),
                    api_key.clone(),
                    "image/jpeg".into(),
                    true,
                );
                match upload.await {
                    Ok(result) => attachments.push(ChatAttachment {
                        kind: AttachmentKind::Image,
                        path: result.path,
                        mime_type: result.mime_type,
                    }),
                    Err(e) => {
                        failure = Some(format!("Image upload failed: {e}"));
                        break;
                    }
                }
            }
            if failure.is_none() {
                if let Some(audio) = audio {
                    let upload = client.upload_file(
                        audio.path.clone(),
                        upload_url.clone(),
                        api_key.clone(),
                        audio.mime_type.clone(),
                        true,
                    );
                    match upload.await {
                        Ok(result) => attachments.push(ChatAttachment {
                            kind: AttachmentKind::Audio,
                            path: result.path,
                            mime_type: result.mime_type,
                        }),
                        Err(e) => failure = Some(format!("Audio upload failed: {e}")),
                    }
                }
            }

            this.update(cx, |this, cx| {
                this.sending = false;
                match failure {
                    Some(error) => {
                        this.error = Some(error.into());
                        // Drop the optimistic bubble — the send never happened.
                        this.store.update(cx, |store, cx| {
                            store.clear_pending();
                            cx.notify();
                        });
                    }
                    None => {
                        this.store
                            .update(cx, |store, cx| store.send_chat(text, Some(attachments), cx));
                    }
                }
            })
            .ok();
        })
        .detach();
    }

    fn render_chips(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        if self.pending_images.is_empty() && self.pending_audio.is_none() && self.error.is_none() {
            return None;
        }
        let mut chips = div().w_full().px_1().pb_1().h_flex().gap_2().flex_wrap();

        for (ix, image) in self.pending_images.iter().enumerate() {
            let processing = image.temp_path.as_os_str().is_empty();
            chips = chips.child(
                div()
                    .id(SharedString::from(format!("img-chip-{ix}")))
                    .px_2()
                    .py_0p5()
                    .rounded_md()
                    .bg(cx.theme().muted)
                    .h_flex()
                    .gap_1()
                    .text_xs()
                    .map(|this| {
                        // Staged file on disk → thumbnail; still resizing →
                        // generic file icon.
                        if processing {
                            this.child(Icon::new(IconName::File).xsmall())
                        } else {
                            this.child(
                                gpui::img(image.temp_path.clone())
                                    .rounded_sm()
                                    .max_w(px(40.))
                                    .max_h(px(28.)),
                            )
                        }
                    })
                    .child(if processing {
                        format!("{}…", image.original_name)
                    } else {
                        image.original_name.clone()
                    })
                    .child(
                        Button::new(SharedString::from(format!("img-rm-{ix}")))
                            .icon(IconName::Close)
                            .ghost()
                            .xsmall()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if ix < this.pending_images.len() {
                                    let removed = this.pending_images.remove(ix);
                                    let _ = std::fs::remove_file(removed.temp_path);
                                }
                                cx.notify();
                            })),
                    ),
            );
        }

        if let Some(audio) = &self.pending_audio {
            chips = chips.child(
                div()
                    .px_2()
                    .py_0p5()
                    .rounded_md()
                    .bg(cx.theme().muted)
                    .h_flex()
                    .gap_1()
                    .text_xs()
                    .child(Icon::new(IconName::Bell).xsmall())
                    .child(format!("audio · {:.1}s", audio.duration))
                    .child(
                        Button::new("audio-rm")
                            .icon(IconName::Close)
                            .ghost()
                            .xsmall()
                            .on_click(cx.listener(|this, _, _, cx| {
                                if let Some(audio) = this.pending_audio.take() {
                                    let _ = std::fs::remove_file(audio.path);
                                }
                                cx.notify();
                            })),
                    ),
            );
        }

        if let Some(error) = &self.error {
            chips = chips.child(
                div()
                    .text_xs()
                    .text_color(cx.theme().danger)
                    .child(error.clone()),
            );
        }

        Some(chips)
    }
}

impl Render for Composer {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let streaming = self.store.read(cx).streaming.is_some();
        let chips = self.render_chips(cx);

        div()
            .w_full()
            .p_3()
            .border_t_1()
            .border_color(cx.theme().border)
            .v_flex()
            .gap_1()
            .on_drop(cx.listener(|this, paths: &ExternalPaths, _, cx| {
                this.add_image_paths(paths.paths().to_vec(), cx);
            }))
            .capture_action(
                cx.listener(|this, _: &gpui_component::input::Paste, _, cx| {
                    if this.paste_clipboard_image(cx) {
                        cx.stop_propagation();
                    }
                }),
            )
            .children(chips)
            .child(
                div()
                    .w_full()
                    .h_flex()
                    .gap_2()
                    .items_end()
                    .child(
                        Button::new("attach")
                            .icon(IconName::Plus)
                            .ghost()
                            .on_click(cx.listener(|this, _, _, cx| this.pick_images(cx))),
                    )
                    .child(
                        Button::new("record")
                            .icon(IconName::Bell)
                            .map(|b| {
                                if self.recording {
                                    b.danger()
                                } else {
                                    b.ghost()
                                }
                            })
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_recording(cx))),
                    )
                    .child(div().flex_1().child(Input::new(&self.input)))
                    .map(|this| {
                        if streaming {
                            this.child(
                                Button::new("abort")
                                    .icon(IconName::CircleX)
                                    .danger()
                                    .label("Stop")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.store.update(cx, |store, cx| store.abort_turn(cx));
                                    })),
                            )
                        } else {
                            this.child(
                                Button::new("send")
                                    .icon(IconName::ArrowUp)
                                    .primary()
                                    .loading(self.sending)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.send(window, cx);
                                    })),
                            )
                        }
                    }),
            )
    }
}
