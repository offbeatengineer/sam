//! Right-hand artifact panel: native preview for markdown/code/images, wry
//! WebView for HTML (the agent's artifact server injects live-reload).

use std::sync::Arc;

use gpui::{div, prelude::*, px, Context, Entity, Image, ImageFormat, SharedString, Window};
use gpui_component::{
    button::{Button, ButtonVariants},
    webview::WebView,
    wry, ActiveTheme, IconName, Sizable, StyledExt,
};

use crate::markdown::md;
use crate::state::ui::UiState;
use crate::state::ConnectionState;

enum Content {
    None,
    Loading,
    Text(String),
    Image(Arc<Image>),
    Html, // rendered by the webview
    Error(String),
}

pub struct ArtifactPanel {
    ui: Entity<UiState>,
    conn: Entity<ConnectionState>,
    /// Path the current `content`/webview was loaded for.
    loaded_path: Option<String>,
    content: Content,
    webview: Option<Entity<WebView>>,
}

fn extension(path: &str) -> String {
    path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase()
}

fn image_format(ext: &str) -> Option<ImageFormat> {
    match ext {
        "png" => Some(ImageFormat::Png),
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "webp" => Some(ImageFormat::Webp),
        "gif" => Some(ImageFormat::Gif),
        "svg" => Some(ImageFormat::Svg),
        _ => None,
    }
}

impl ArtifactPanel {
    pub fn new(
        ui: Entity<UiState>,
        conn: Entity<ConnectionState>,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.observe(&ui, |this: &mut Self, _, cx| {
            this.sync(cx);
            cx.notify();
        })
        .detach();

        Self {
            ui,
            conn,
            loaded_path: None,
            content: Content::None,
            webview: None,
        }
    }

    /// Re-fetch when an `artifacts_changed` broadcast touches the open file
    /// (the HTML webview live-reloads itself via the injected script).
    pub fn refresh_if_open(&mut self, changed_path: &str, cx: &mut Context<Self>) {
        if self
            .loaded_path
            .as_deref()
            .is_some_and(|p| changed_path.ends_with(p) || p.ends_with(changed_path))
        {
            self.loaded_path = None;
            self.sync(cx);
        }
    }

    fn artifact_url(&self, path: &str, cx: &Context<Self>) -> Option<String> {
        let base = self.conn.read(cx).artifacts_url()?;
        let mut url = format!("{base}/{path}");
        if let Some(key) = self
            .conn
            .read(cx)
            .active_instance()
            .and_then(|i| i.api_key.clone())
        {
            let sep = if url.contains('?') { '&' } else { '?' };
            url.push(sep);
            url.push_str(&format!("apiKey={key}"));
        }
        Some(url)
    }

    fn sync(&mut self, cx: &mut Context<Self>) {
        let selected = self.ui.read(cx).selected_artifact.clone();
        if selected == self.loaded_path {
            return;
        }
        let Some(path) = selected else {
            self.loaded_path = None;
            self.content = Content::None;
            self.webview = None; // drops + hides the native view
            return;
        };

        self.loaded_path = Some(path.clone());
        let ext = extension(&path);
        let Some(url) = self.artifact_url(&path, cx) else {
            self.content = Content::Error("not connected".into());
            return;
        };

        if ext == "html" || ext == "htm" {
            self.content = Content::Html;
            match &self.webview {
                Some(webview) => webview.update(cx, |webview, _| webview.load_url(&url)),
                None => {
                    // Created on next render, where we have a &mut Window.
                }
            }
            cx.notify();
            return;
        }

        self.webview = None;
        self.content = Content::Loading;
        let client = self.conn.read(cx).client.clone();
        let fetch = client.fetch_bytes(url, None); // key already in query
        cx.spawn(async move |this, cx| {
            let result = fetch.await;
            this.update(cx, |this, cx| {
                if this.loaded_path.as_deref() != Some(path.as_str()) {
                    return; // user opened something else meanwhile
                }
                this.content = match result {
                    Ok(bytes) => {
                        if let Some(format) = image_format(&ext) {
                            Content::Image(Arc::new(Image::from_bytes(format, bytes)))
                        } else {
                            match String::from_utf8(bytes) {
                                Ok(text) => Content::Text(text),
                                Err(_) => Content::Error("binary file — open in browser".into()),
                            }
                        }
                    }
                    Err(e) => Content::Error(e.to_string()),
                };
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn ensure_webview(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.webview.is_some() || !matches!(self.content, Content::Html) {
            return;
        }
        let Some(path) = self.loaded_path.clone() else { return };
        let Some(url) = self.artifact_url(&path, cx) else { return };
        match wry::WebViewBuilder::new()
            .with_url(&url)
            .build_as_child(window)
        {
            Ok(raw) => {
                let webview = cx.new(|cx| WebView::new(raw, window, cx));
                self.webview = Some(webview);
            }
            Err(e) => {
                log::error!("webview creation failed: {e}");
                self.content = Content::Error(format!("WebView failed: {e} — open in browser"));
            }
        }
    }
}

impl Render for ArtifactPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(path) = self.loaded_path.clone() else {
            return div().into_any_element();
        };
        self.ensure_webview(window, cx);

        let filename = path.rsplit('/').next().unwrap_or(&path).to_string();
        let browser_url = self.artifact_url(&path, cx);

        let body = match &self.content {
            Content::Html => match &self.webview {
                Some(webview) => div().size_full().child(webview.clone()).into_any_element(),
                None => div().into_any_element(),
            },
            Content::Text(text) => {
                let rendered = if extension(&path) == "md" {
                    text.clone()
                } else {
                    format!("```{}\n{}\n```", extension(&path), text)
                };
                div()
                    .id("artifact-scroll")
                    .size_full()
                    .overflow_y_scroll()
                    .p_3()
                    .child(md(
                        SharedString::from(format!("artifact-{path}")),
                        rendered,
                        window,
                        cx,
                    ))
                    .into_any_element()
            }
            Content::Image(image) => div()
                .size_full()
                .p_3()
                .flex()
                .items_center()
                .justify_center()
                .child(gpui::img(image.clone()).max_w_full().max_h_full())
                .into_any_element(),
            Content::Loading => div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .text_color(cx.theme().muted_foreground)
                .child("Loading…")
                .into_any_element(),
            Content::Error(error) => div()
                .size_full()
                .p_4()
                .text_sm()
                .text_color(cx.theme().danger)
                .child(error.clone())
                .into_any_element(),
            Content::None => div().into_any_element(),
        };

        div()
            .h_full()
            .w(px(480.))
            .flex_none()
            .border_l_1()
            .border_color(cx.theme().border)
            .v_flex()
            .child(
                div()
                    .w_full()
                    .px_3()
                    .py_2()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .h_flex()
                    .gap_2()
                    .child(div().flex_1().text_sm().font_semibold().truncate().child(filename))
                    .when_some(browser_url, |this, url| {
                        this.child(
                            Button::new("open-browser")
                                .icon(IconName::ExternalLink)
                                .ghost()
                                .small()
                                .on_click(move |_, _, cx| cx.open_url(&url)),
                        )
                    })
                    .child(
                        Button::new("close-artifact")
                            .icon(IconName::Close)
                            .ghost()
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.ui.update(cx, |ui, cx| ui.close_artifact(cx));
                            })),
                    ),
            )
            .child(div().flex_1().min_h_0().child(body))
            .into_any_element()
    }
}
