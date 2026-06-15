//! Session list + active session entries (the read-only half of the Tauri
//! client's `sessionStore`). Streaming-turn state lands here in M3.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use gpui::{Context, EventEmitter};
use sam_client::SamClient;
use sam_protocol::{
    session::{parse_entry, SessionEntry},
    AppRequest, AppResponse, SessionInfoDto,
};

pub fn request_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub struct ActiveSession {
    pub info: SessionInfoDto,
    pub entries: Vec<SessionEntry>,
    /// Indices into `entries` that produce a visible row in the chat.
    pub display_indices: Vec<usize>,
    /// toolCallId → result, for rendering results inline at the assistant's
    /// tool-call position (toolResult entries themselves render no row —
    /// same as the Tauri client's MessageList/MessageEntryView).
    pub tool_results: std::sync::Arc<HashMap<String, ToolResultInfo>>,
    pub loading: bool,
}

#[derive(Debug, Clone)]
pub struct ToolResultInfo {
    pub text: String,
    pub is_error: bool,
    pub details: Option<serde_json::Value>,
}

fn collect_tool_results(entries: &[SessionEntry]) -> HashMap<String, ToolResultInfo> {
    use sam_protocol::session::{AgentMessage, ContentItem};
    let mut map = HashMap::new();
    for entry in entries {
        if let SessionEntry::Message {
            message:
                AgentMessage::ToolResult {
                    tool_call_id,
                    content,
                    is_error,
                    details,
                    ..
                },
            ..
        } = entry
        {
            let text = content
                .iter()
                .filter_map(|item| match item {
                    ContentItem::Text { text, .. } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n");
            map.insert(
                tool_call_id.clone(),
                ToolResultInfo {
                    text,
                    is_error: *is_error,
                    details: details.clone(),
                },
            );
        }
    }
    map
}

// --- Streaming turn (port of StreamingTurn in desktop sessionStore.ts) ---

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolStatus {
    Running,
    Done,
    Error,
}

#[derive(Debug, Clone)]
pub enum StreamItem {
    Text(String),
    Thinking {
        content: String,
        complete: bool,
    },
    Tool {
        id: String,
        name: String,
        status: ToolStatus,
        args: serde_json::Value,
        result: Option<String>,
        /// Tool-specific structured payload from `tool_end` (drives the
        /// special cards: web_search results, artifact metadata, …).
        details: Option<serde_json::Value>,
    },
}

pub struct StreamingTurn {
    pub conversation_id: String,
    pub items: Vec<StreamItem>,
    /// Bumped on every mutation so views know to invalidate the live row.
    pub revision: u64,
}

impl StreamingTurn {
    fn new(conversation_id: String) -> Self {
        Self {
            conversation_id,
            items: Vec::new(),
            revision: 0,
        }
    }

    fn append_text(&mut self, delta: &str) {
        if let Some(StreamItem::Text(text)) = self.items.last_mut() {
            text.push_str(delta);
        } else {
            self.items.push(StreamItem::Text(delta.to_string()));
        }
        self.revision += 1;
    }

    fn append_thinking(&mut self, delta: &str) {
        if let Some(StreamItem::Thinking { content, complete }) = self.items.last_mut() {
            if !*complete {
                content.push_str(delta);
                self.revision += 1;
                return;
            }
        }
        self.items.push(StreamItem::Thinking {
            content: delta.to_string(),
            complete: false,
        });
        self.revision += 1;
    }

    fn end_thinking(&mut self) {
        if let Some(StreamItem::Thinking { complete, .. }) = self.items.last_mut() {
            *complete = true;
            self.revision += 1;
        }
    }

    fn start_tool(&mut self, id: String, name: String, args: serde_json::Value) {
        self.items.push(StreamItem::Tool {
            id,
            name,
            status: ToolStatus::Running,
            args,
            result: None,
            details: None,
        });
        self.revision += 1;
    }

    fn update_tool(&mut self, tool_call_id: &str, partial: String) {
        for item in self.items.iter_mut().rev() {
            if let StreamItem::Tool { id, result, .. } = item {
                if id == tool_call_id {
                    *result = Some(partial);
                    self.revision += 1;
                    return;
                }
            }
        }
    }

    fn end_tool(
        &mut self,
        tool_call_id: &str,
        output: String,
        is_error: bool,
        tool_details: Option<serde_json::Value>,
    ) {
        for item in self.items.iter_mut().rev() {
            if let StreamItem::Tool {
                id,
                status,
                result,
                details,
                ..
            } = item
            {
                if id == tool_call_id {
                    *status = if is_error {
                        ToolStatus::Error
                    } else {
                        ToolStatus::Done
                    };
                    *result = Some(output);
                    *details = tool_details;
                    self.revision += 1;
                    return;
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStoreEvent {
    SessionsLoaded,
    EntriesLoaded,
}

/// The just-sent user message shown optimistically until the JSONL refresh
/// includes it. `images` are local preview-temp copies owned by the store
/// (deleted in `clear_pending`); `audio_secs` is a staged voice clip's length.
#[derive(Clone, Default)]
pub struct PendingUser {
    pub text: String,
    pub images: Vec<PathBuf>,
    pub audio_secs: Option<f32>,
}

pub struct SessionStore {
    client: SamClient,
    pub sessions: Vec<SessionInfoDto>,
    pub active: Option<ActiveSession>,
    pub streaming: Option<StreamingTurn>,
    /// Conversations *other than* the active one with an in-flight turn →
    /// last text preview. Drives the sidebar "working" dot and background
    /// turn-end notifications. Populated when the user navigates away from a
    /// streaming session (and from any stray non-active stream events).
    pub background_turns: HashMap<String, String>,
    /// Message just sent, shown until the JSONL refresh includes it.
    pub pending_user: Option<PendingUser>,
    /// After an instance switch: select the newest app-channel session once
    /// the next sessions list arrives (port of `switchInstance` step 5).
    auto_select_latest: bool,
    /// Active session-search matches by conversationId; `None` = not searching
    /// (port of `sessionSearchStore.matchingIds`).
    pub search_matches: Option<HashSet<String>>,
    /// A `session_search` request is in flight (results not back yet).
    pub searching: bool,
    /// Archived sessions, lazy-loaded the first time the sidebar group expands.
    pub archived: Vec<SessionInfoDto>,
    pub archived_loaded: bool,
}

impl EventEmitter<SessionStoreEvent> for SessionStore {}

impl SessionStore {
    pub fn new(client: SamClient) -> Self {
        Self {
            client,
            sessions: Vec::new(),
            active: None,
            streaming: None,
            background_turns: HashMap::new(),
            pending_user: None,
            auto_select_latest: false,
            search_matches: None,
            searching: false,
            archived: Vec::new(),
            archived_loaded: false,
        }
    }

    /// Drop everything tied to the previous backend instance (port of the
    /// store clearing in `switchInstance`/`removeInstance`). The next
    /// sessions list auto-selects the newest app-channel session.
    pub fn clear_all(&mut self, cx: &mut Context<Self>) {
        self.sessions.clear();
        self.active = None;
        self.streaming = None;
        self.background_turns.clear();
        self.clear_pending();
        self.auto_select_latest = true;
        self.search_matches = None;
        self.searching = false;
        self.archived.clear();
        self.archived_loaded = false;
        cx.notify();
    }

    /// When navigating away from a session whose turn is still streaming, keep
    /// the turn tracked in `background_turns` (sidebar dot + turn-end notify)
    /// instead of dropping it. The live rendered view is discarded — only the
    /// active conversation streams into the message list.
    fn demote_streaming_to_background(&mut self) {
        if let Some(turn) = self.streaming.take() {
            let preview = turn
                .items
                .iter()
                .rev()
                .find_map(|item| match item {
                    StreamItem::Text(t) => Some(t.chars().take(200).collect::<String>()),
                    _ => None,
                })
                .unwrap_or_default();
            self.background_turns.insert(turn.conversation_id, preview);
        }
    }

    /// Start a fresh conversation; the session file (and its path) appears
    /// server-side after the first turn, discovered via the sessions refresh.
    pub fn new_session(&mut self, cx: &mut Context<Self>) {
        let conversation_id = uuid::Uuid::new_v4().to_string().to_uppercase();
        self.active = Some(ActiveSession {
            info: SessionInfoDto {
                path: String::new(),
                id: String::new(),
                channel_id: "app".into(),
                conversation_id,
                cwd: String::new(),
                name: None,
                created: String::new(),
                modified: String::new(),
                message_count: 0,
                first_message: "New session".into(),
            },
            entries: Vec::new(),
            display_indices: Vec::new(),
            tool_results: Default::default(),
            loading: false,
        });
        self.demote_streaming_to_background();
        self.clear_pending();
        cx.notify();
    }

    /// Show the just-sent message optimistically with its attachment previews
    /// (called by the composer at send-start, before the upload completes).
    /// Takes ownership of `images` (preview-temp copies); `clear_pending`
    /// deletes them once the real entry lands.
    pub fn set_pending(
        &mut self,
        text: String,
        images: Vec<PathBuf>,
        audio_secs: Option<f32>,
        cx: &mut Context<Self>,
    ) {
        self.clear_pending();
        self.pending_user = Some(PendingUser {
            text,
            images,
            audio_secs,
        });
        cx.notify();
    }

    /// Drop the optimistic bubble and delete its preview-temp images.
    pub fn clear_pending(&mut self) {
        if let Some(pending) = self.pending_user.take() {
            for path in pending.images {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    pub fn send_chat(
        &mut self,
        text: String,
        attachments: Option<Vec<sam_protocol::ChatAttachment>>,
        cx: &mut Context<Self>,
    ) {
        let Some(active) = &self.active else { return };
        if active.info.channel_id != "app" || self.streaming.is_some() {
            return;
        }
        let conversation_id = active.info.conversation_id.clone();
        // Composer sets a richer pending (with attachment previews) before
        // uploading; only fall back to text-only here (e.g. SAM_AUTOSEND).
        if self.pending_user.is_none() {
            self.pending_user = Some(PendingUser {
                text: text.clone(),
                images: Vec::new(),
                audio_secs: None,
            });
        }
        self.streaming = Some(StreamingTurn::new(conversation_id.clone()));
        self.client.send(AppRequest::Chat {
            request_id: request_id(),
            conversation_id,
            text,
            attachments,
        });
        cx.notify();
    }

    pub fn client(&self) -> SamClient {
        self.client.clone()
    }

    pub fn abort_turn(&mut self, cx: &mut Context<Self>) {
        if let Some(streaming) = &self.streaming {
            self.client.send(AppRequest::Abort {
                conversation_id: streaming.conversation_id.clone(),
            });
        }
        cx.notify();
    }

    /// Route a streaming/broadcast response (anything carrying a
    /// conversationId) — port of the dispatch in `ChatContainer.tsx`.
    pub fn handle_stream_response(&mut self, response: AppResponse, cx: &mut Context<Self>) {
        let active_conv = self
            .active
            .as_ref()
            .map(|a| a.info.conversation_id.clone())
            .unwrap_or_default();
        let for_active = response.conversation_id() == Some(active_conv.as_str());

        match response {
            AppResponse::SessionCreated { .. } => {
                // Session file now exists on disk; refresh the sidebar (and
                // adopt the path for a brand-new active session).
                self.load_sessions(cx);
                return;
            }
            resp if !for_active => {
                self.handle_background_stream(&resp, cx);
                return;
            }
            AppResponse::TurnStart { .. } => {
                if self.streaming.is_none() {
                    self.streaming = Some(StreamingTurn::new(active_conv));
                }
            }
            AppResponse::TextDelta { delta, .. } => {
                if let Some(s) = &mut self.streaming {
                    s.append_text(&delta);
                }
            }
            AppResponse::ThinkingDelta { delta, .. } => {
                if let Some(s) = &mut self.streaming {
                    s.append_thinking(&delta);
                }
            }
            AppResponse::ThinkingEnd { .. } => {
                if let Some(s) = &mut self.streaming {
                    s.end_thinking();
                }
            }
            AppResponse::ToolStart {
                tool_call_id,
                tool_name,
                args,
                ..
            } => {
                if let Some(s) = &mut self.streaming {
                    s.start_tool(tool_call_id, tool_name, args);
                }
            }
            AppResponse::ToolUpdate {
                tool_call_id,
                partial_result,
                ..
            } => {
                if let Some(s) = &mut self.streaming {
                    s.update_tool(&tool_call_id, partial_result);
                }
            }
            AppResponse::ToolEnd {
                tool_call_id,
                result,
                is_error,
                details,
                ..
            } => {
                if let Some(s) = &mut self.streaming {
                    s.end_tool(&tool_call_id, result, is_error, details);
                }
            }
            AppResponse::TurnEnd { .. } | AppResponse::Aborted { .. } => {
                self.end_streaming(cx);
            }
            AppResponse::Error { error, .. } => {
                log::warn!("turn error: {error}");
                if let Some(s) = &mut self.streaming {
                    s.append_text(&format!("\n\n**Error:** {error}"));
                }
                self.end_streaming(cx);
            }
            _ => {}
        }
        cx.notify();
    }

    /// Lightweight tracking for a turn streaming in a non-active conversation:
    /// just enough to show the sidebar dot and build a turn-end notification
    /// (we don't render its content — only the active turn streams to the list).
    fn handle_background_stream(&mut self, response: &AppResponse, cx: &mut Context<Self>) {
        let Some(conv) = response.conversation_id() else {
            return;
        };
        match response {
            AppResponse::TurnStart { .. }
            | AppResponse::ToolStart { .. }
            | AppResponse::ThinkingDelta { .. } => {
                self.background_turns.entry(conv.to_string()).or_default();
            }
            AppResponse::TextDelta { delta, .. } => {
                let preview = self.background_turns.entry(conv.to_string()).or_default();
                if preview.chars().count() < 200 {
                    preview.push_str(delta);
                }
            }
            AppResponse::TurnEnd { .. }
            | AppResponse::Aborted { .. }
            | AppResponse::Error { .. } => {
                self.background_turns.remove(conv);
            }
            _ => {}
        }
        cx.notify();
    }

    /// Notification preview for a just-finished turn, whether it was the active
    /// rendered turn or a backgrounded one. `None` if we weren't tracking it.
    pub fn turn_preview(&self, conv: &str) -> Option<String> {
        if let Some(s) = &self.streaming {
            if s.conversation_id == conv {
                return Some(
                    s.items
                        .iter()
                        .rev()
                        .find_map(|item| match item {
                            StreamItem::Text(t) => Some(t.chars().take(120).collect::<String>()),
                            _ => None,
                        })
                        .unwrap_or_else(|| "Turn finished".into()),
                );
            }
        }
        self.background_turns.get(conv).map(|p| {
            if p.is_empty() {
                "Turn finished".into()
            } else {
                p.clone()
            }
        })
    }

    /// Streaming UI is ephemeral; the JSONL on disk is the source of truth.
    fn end_streaming(&mut self, cx: &mut Context<Self>) {
        self.streaming = None;
        match &self.active {
            Some(active) if active.info.path.is_empty() => {
                // New session: discover the file via re-list, then adopt.
                self.load_sessions(cx);
            }
            Some(_) => self.load_active_entries(cx),
            None => {}
        }
        cx.notify();
    }

    pub fn load_sessions(&mut self, cx: &mut Context<Self>) {
        let client = self.client.clone();
        cx.spawn(async move |this, cx| {
            let response = client
                .request(AppRequest::ListSessions {
                    request_id: request_id(),
                })
                .await;
            match response {
                Ok(AppResponse::SessionsList { mut sessions, .. }) => {
                    log::info!("loaded {} sessions", sessions.len());
                    // ISO timestamps sort lexicographically; newest first.
                    sessions.sort_by(|a, b| b.modified.cmp(&a.modified));
                    this.update(cx, |store, cx| {
                        store.sessions = sessions;
                        cx.emit(SessionStoreEvent::SessionsLoaded);
                        cx.notify();
                        // Adopt the on-disk session for a freshly created
                        // conversation (path was unknown until now).
                        let adopted = store.active.as_ref().and_then(|active| {
                            if !active.info.path.is_empty() {
                                return None;
                            }
                            store
                                .sessions
                                .iter()
                                .find(|s| s.conversation_id == active.info.conversation_id)
                                .cloned()
                        });
                        if let Some(found) = adopted {
                            if let Some(active) = &mut store.active {
                                active.info = found;
                            }
                            store.load_active_entries(cx);
                        }
                        // After an instance switch: open the newest
                        // app-channel session (or the newest of any channel).
                        if store.auto_select_latest {
                            store.auto_select_latest = false;
                            let pick = store
                                .sessions
                                .iter()
                                .find(|s| s.channel_id == "app")
                                .or(store.sessions.first())
                                .cloned();
                            if let Some(info) = pick {
                                store.select_session(info, cx);
                            }
                        }
                        // Dev hook: SAM_AUTOSELECT=<index> opens the Nth
                        // session on startup (headless UI verification).
                        if store.active.is_none() {
                            if let Some(info) = std::env::var("SAM_AUTOSELECT")
                                .ok()
                                .and_then(|v| v.parse::<usize>().ok())
                                .and_then(|ix| store.sessions.get(ix).cloned())
                            {
                                store.select_session(info, cx);
                            }
                        }
                    })
                    .ok();
                }
                Ok(other) => log::warn!("unexpected list_sessions response: {other:?}"),
                Err(e) => log::warn!("list_sessions failed: {e}"),
            }
        })
        .detach();
    }

    pub fn select_session(&mut self, info: SessionInfoDto, cx: &mut Context<Self>) {
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.info.path == info.path)
        {
            return;
        }
        let new_conv = info.conversation_id.clone();
        // A turn still running in the session we're leaving moves to the
        // background (dot + notify); entering this one clears its own dot.
        self.demote_streaming_to_background();
        self.background_turns.remove(&new_conv);
        self.active = Some(ActiveSession {
            info: info.clone(),
            entries: Vec::new(),
            display_indices: Vec::new(),
            tool_results: Default::default(),
            loading: true,
        });
        self.clear_pending();
        cx.notify();
        self.load_active_entries(cx);
    }

    /// (Re)load the active session's entries from its JSONL file — also used
    /// after a turn ends in M3 (the file is the source of truth).
    pub fn load_active_entries(&mut self, cx: &mut Context<Self>) {
        let Some(path) = self.active.as_ref().map(|a| a.info.path.clone()) else {
            return;
        };
        let client = self.client.clone();
        cx.spawn(async move |this, cx| {
            let response = client
                .request(AppRequest::GetSessionEntries {
                    request_id: request_id(),
                    session_path: path.clone(),
                })
                .await;
            match response {
                Ok(AppResponse::SessionEntries { entries, .. }) => {
                    this.update(cx, |store, cx| {
                        let Some(active) = &mut store.active else {
                            return;
                        };
                        if active.info.path != path {
                            return; // user switched sessions mid-load
                        }
                        active.entries = entries.into_iter().map(parse_entry).collect();
                        active.tool_results =
                            std::sync::Arc::new(collect_tool_results(&active.entries));
                        active.display_indices = active
                            .entries
                            .iter()
                            .enumerate()
                            .filter(|(_, e)| is_displayable(e))
                            .map(|(i, _)| i)
                            .collect();
                        active.loading = false;
                        // Field-level clear (disjoint from the &mut active
                        // borrow above; clear_pending() would reborrow *store).
                        if let Some(p) = store.pending_user.take() {
                            for img in p.images {
                                let _ = std::fs::remove_file(img);
                            }
                        }
                        log::info!(
                            "loaded {} entries ({} displayable) for {}",
                            active.entries.len(),
                            active.display_indices.len(),
                            active.info.conversation_id
                        );
                        cx.emit(SessionStoreEvent::EntriesLoaded);
                        cx.notify();
                    })
                    .ok();
                }
                Ok(other) => log::warn!("unexpected session_entries response: {other:?}"),
                Err(e) => log::warn!("get_session_entries failed: {e}"),
            }
        })
        .detach();
    }

    pub fn rename_session(&mut self, path: String, name: String, cx: &mut Context<Self>) {
        let client = self.client.clone();
        cx.spawn(async move |this, cx| {
            let response = client
                .request(AppRequest::RenameSession {
                    request_id: request_id(),
                    session_path: path,
                    name,
                })
                .await;
            if let Err(e) = response {
                log::warn!("rename_session failed: {e}");
            }
            this.update(cx, |store, cx| store.load_sessions(cx)).ok();
        })
        .detach();
    }

    pub fn archive_session(&mut self, path: String, cx: &mut Context<Self>) {
        let client = self.client.clone();
        cx.spawn(async move |this, cx| {
            let response = client
                .request(AppRequest::ArchiveSession {
                    request_id: request_id(),
                    session_path: path.clone(),
                })
                .await;
            if let Err(e) = response {
                log::warn!("archive_session failed: {e}");
            }
            this.update(cx, |store, cx| {
                if store
                    .active
                    .as_ref()
                    .is_some_and(|active| active.info.path == path)
                {
                    store.active = None;
                }
                store.load_sessions(cx);
                // Keep the archived group in sync if it's already open.
                if store.archived_loaded {
                    store.load_archived(cx);
                }
            })
            .ok();
        })
        .detach();
    }

    // --- Session search (port of `sessionSearchApi` + `sessionSearchStore`) ---

    /// Run a `session_search`; the sidebar filters the loaded list to the
    /// matching conversationIds once results arrive. Empty query clears.
    pub fn search_sessions(&mut self, query: String, cx: &mut Context<Self>) {
        let query = query.trim().to_string();
        if query.is_empty() {
            self.clear_search(cx);
            return;
        }
        self.searching = true;
        cx.notify();
        let client = self.client.clone();
        cx.spawn(async move |this, cx| {
            let response = client
                .request(AppRequest::SessionSearch {
                    request_id: request_id(),
                    query,
                    limit: Some(20),
                })
                .await;
            this.update(cx, |store, cx| {
                store.searching = false;
                match response {
                    Ok(AppResponse::SessionSearchResult { results, .. }) => {
                        store.search_matches =
                            Some(results.into_iter().map(|r| r.conversation_id).collect());
                    }
                    Ok(other) => {
                        log::warn!("unexpected session_search response: {other:?}");
                        store.search_matches = Some(HashSet::new());
                    }
                    Err(e) => {
                        log::warn!("session_search failed: {e}");
                        store.search_matches = Some(HashSet::new());
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Leave search mode and show the full session list again.
    pub fn clear_search(&mut self, cx: &mut Context<Self>) {
        if self.search_matches.is_some() || self.searching {
            self.search_matches = None;
            self.searching = false;
            cx.notify();
        }
    }

    // --- Archived sessions (port of `loadArchivedSessions`/`unarchiveSession`) ---

    /// Lazy-load the archived sessions (called when the sidebar group expands).
    pub fn load_archived(&mut self, cx: &mut Context<Self>) {
        let client = self.client.clone();
        cx.spawn(async move |this, cx| {
            let response = client
                .request(AppRequest::ListArchivedSessions {
                    request_id: request_id(),
                })
                .await;
            this.update(cx, |store, cx| {
                match response {
                    Ok(AppResponse::ArchivedSessionsList { mut sessions, .. }) => {
                        sessions.sort_by(|a, b| b.modified.cmp(&a.modified));
                        store.archived = sessions;
                    }
                    Ok(other) => log::warn!("unexpected archived list response: {other:?}"),
                    Err(e) => log::warn!("list_archived_sessions failed: {e}"),
                }
                store.archived_loaded = true;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub fn unarchive_session(&mut self, path: String, cx: &mut Context<Self>) {
        let client = self.client.clone();
        cx.spawn(async move |this, cx| {
            let response = client
                .request(AppRequest::UnarchiveSession {
                    request_id: request_id(),
                    session_path: path,
                })
                .await;
            if let Err(e) = response {
                log::warn!("unarchive_session failed: {e}");
            }
            this.update(cx, |store, cx| {
                store.load_sessions(cx);
                store.load_archived(cx);
            })
            .ok();
        })
        .detach();
    }
}

fn is_displayable(entry: &SessionEntry) -> bool {
    use sam_protocol::session::AgentMessage;
    match entry {
        SessionEntry::Message { message, .. } => match message {
            AgentMessage::Custom { display, .. } => *display,
            // Results render inline at the assistant's tool-call row (via
            // ActiveSession::tool_results), not as their own row.
            AgentMessage::ToolResult { .. } => false,
            _ => true,
        },
        SessionEntry::CustomMessage { display, .. } => *display,
        SessionEntry::Compaction { .. }
        | SessionEntry::BranchSummary { .. }
        | SessionEntry::ModelChange { .. }
        | SessionEntry::ThinkingLevelChange { .. }
        | SessionEntry::Unknown { .. } => true,
        // Voice messages persist as audio_attachment custom entries; the
        // agent adds data.url at serve time (see stripAttachmentData).
        SessionEntry::Custom {
            custom_type, data, ..
        } => {
            custom_type == "audio_attachment"
                && data
                    .as_ref()
                    .is_some_and(|d| d.get("url").and_then(|u| u.as_str()).is_some())
        }
        SessionEntry::Label { .. } | SessionEntry::SessionInfo { .. } => false,
    }
}
