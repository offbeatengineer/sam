//! Cross-cutting UI state (artifact panel), reachable from anywhere via a
//! gpui Global — entry renderers are plain functions with only `&mut App`.

use gpui::{App, Context, Entity, Global};

pub struct UiState {
    /// Artifact path relative to the agent's artifacts root, if the panel is open.
    pub selected_artifact: Option<String>,
}

impl UiState {
    pub fn new() -> Self {
        Self {
            selected_artifact: None,
        }
    }

    pub fn open_artifact(&mut self, path: String, cx: &mut Context<Self>) {
        self.selected_artifact = Some(path);
        cx.notify();
    }

    pub fn close_artifact(&mut self, cx: &mut Context<Self>) {
        self.selected_artifact = None;
        cx.notify();
    }
}

pub struct UiStateGlobal(pub Entity<UiState>);

impl Global for UiStateGlobal {}

/// Open an artifact in the side panel from anywhere in the app.
pub fn open_artifact(path: String, cx: &mut App) {
    if let Some(ui) = cx.try_global::<UiStateGlobal>().map(|g| g.0.clone()) {
        ui.update(cx, |ui, cx| ui.open_artifact(path, cx));
    }
}
