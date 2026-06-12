//! Async cache for inline chat images. Content items reference images
//! either as base64 `data` or as an upload `url` relative to the agent's
//! HTTP server; both resolve to an `Arc<gpui::Image>` here. The cache entity
//! notifies when a slot fills, and `ChatView` observes it so visible rows
//! re-render. (gpui's own URI image loading is unusable: `Application::new`
//! installs a `NullHttpClient`.)

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use base64::Engine;
use gpui::{App, Context, Entity, Global, Image, ImageFormat};

use crate::state::ConnectionState;

#[derive(Clone)]
pub enum ImageSlot {
    Loading,
    Ready(Arc<Image>),
    Failed,
}

pub struct ImageCache {
    conn: Entity<ConnectionState>,
    slots: HashMap<String, ImageSlot>,
}

pub struct ImageCacheGlobal(pub Entity<ImageCache>);
impl Global for ImageCacheGlobal {}

fn mime_format(mime: &str) -> ImageFormat {
    match mime {
        "image/jpeg" | "image/jpg" => ImageFormat::Jpeg,
        "image/webp" => ImageFormat::Webp,
        "image/gif" => ImageFormat::Gif,
        "image/bmp" => ImageFormat::Bmp,
        "image/tiff" => ImageFormat::Tiff,
        "image/svg+xml" => ImageFormat::Svg,
        _ => ImageFormat::Png,
    }
}

/// Resolve from a render function (which only has `&mut App`).
pub fn resolve_image(data: Option<&str>, mime: &str, url: Option<&str>, cx: &mut App) -> ImageSlot {
    let Some(cache) = cx.try_global::<ImageCacheGlobal>().map(|g| g.0.clone()) else {
        return ImageSlot::Failed;
    };
    let data = data.map(str::to_string);
    let mime = mime.to_string();
    let url = url.map(str::to_string);
    cache.update(cx, |cache, cx| {
        cache.resolve(data.as_deref(), &mime, url.as_deref(), cx)
    })
}

impl ImageCache {
    pub fn new(conn: Entity<ConnectionState>) -> Self {
        Self {
            conn,
            slots: HashMap::new(),
        }
    }

    fn resolve(
        &mut self,
        data: Option<&str>,
        mime: &str,
        url: Option<&str>,
        cx: &mut Context<Self>,
    ) -> ImageSlot {
        let key = match (url, data) {
            (Some(url), _) => format!("url:{url}"),
            (None, Some(data)) => {
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                data.hash(&mut hasher);
                format!("data:{}:{}", data.len(), hasher.finish())
            }
            (None, None) => return ImageSlot::Failed,
        };
        if let Some(slot) = self.slots.get(&key) {
            return slot.clone();
        }
        self.slots.insert(key.clone(), ImageSlot::Loading);

        if let Some(url) = url {
            let conn = self.conn.read(cx);
            let Some(full) = conn.upload_url(url) else {
                self.slots.insert(key, ImageSlot::Failed);
                return ImageSlot::Failed;
            };
            let format = mime_format(mime);
            let fetch = conn.client.fetch_bytes(full, None);
            cx.spawn(async move |this, cx| {
                let slot = match fetch.await {
                    Ok(bytes) => ImageSlot::Ready(Arc::new(Image::from_bytes(format, bytes))),
                    Err(e) => {
                        log::warn!("inline image fetch failed: {e}");
                        ImageSlot::Failed
                    }
                };
                this.update(cx, |this, cx| {
                    this.slots.insert(key, slot);
                    cx.notify();
                })
                .ok();
            })
            .detach();
        } else if let Some(data) = data {
            let data = data.to_string();
            let format = mime_format(mime);
            let decode = cx.background_executor().spawn(async move {
                base64::engine::general_purpose::STANDARD
                    .decode(data.as_bytes())
                    .ok()
                    .map(|bytes| Arc::new(Image::from_bytes(format, bytes)))
            });
            cx.spawn(async move |this, cx| {
                let slot = match decode.await {
                    Some(image) => ImageSlot::Ready(image),
                    None => ImageSlot::Failed,
                };
                this.update(cx, |this, cx| {
                    this.slots.insert(key, slot);
                    cx.notify();
                })
                .ok();
            })
            .detach();
        }
        ImageSlot::Loading
    }
}
