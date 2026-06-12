//! Markdown rendering wrapper — single place to swap implementations or add
//! caching if streaming re-parse shows up in profiles (plan §5).

use gpui::{App, IntoElement, SharedString, Window};
use gpui_component::text::TextView;

pub fn md(
    id: impl Into<SharedString>,
    source: impl Into<SharedString>,
    window: &mut Window,
    cx: &mut App,
) -> impl IntoElement {
    TextView::markdown(id.into(), source, window, cx).selectable(true)
}
