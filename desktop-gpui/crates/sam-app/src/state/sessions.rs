//! Session list + active session entries (the read-only half of the Tauri
//! client's `sessionStore`). Streaming-turn state lands here in M3.

use std::collections::HashMap;

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

pub struct SessionStore {
    client: SamClient,
    pub sessions: Vec<SessionInfoDto>,
    pub active: Option<ActiveSession>,
    pub streaming: Option<StreamingTurn>,
    /// Message just sent, shown until the JSONL refresh includes it.
    pub pending_user: Option<String>,
    /// After an instance switch: select the newest app-channel session once
    /// the next sessions list arrives (port of `switchInstance` step 5).
    auto_select_latest: bool,
}

impl EventEmitter<SessionStoreEvent> for SessionStore {}

impl SessionStore {
    pub fn new(client: SamClient) -> Self {
        Self {
            client,
            sessions: Vec::new(),
            active: None,
            streaming: None,
            pending_user: None,
            auto_select_latest: false,
        }
    }

    /// Drop everything tied to the previous backend instance (port of the
    /// store clearing in `switchInstance`/`removeInstance`). The next
    /// sessions list auto-selects the newest app-channel session.
    pub fn clear_all(&mut self, cx: &mut Context<Self>) {
        self.sessions.clear();
        self.active = None;
        self.streaming = None;
        self.pending_user = None;
        self.auto_select_latest = true;
        cx.notify();
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
        self.streaming = None;
        self.pending_user = None;
        cx.notify();
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
        self.pending_user = Some(text.clone());
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
            _ if !for_active => {
                log::debug!("ignoring stream event for inactive conversation");
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
        self.active = Some(ActiveSession {
            info: info.clone(),
            entries: Vec::new(),
            display_indices: Vec::new(),
            tool_results: Default::default(),
            loading: true,
        });
        self.streaming = None;
        self.pending_user = None;
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
                        store.pending_user = None;
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
        SessionEntry::Custom { .. }
        | SessionEntry::Label { .. }
        | SessionEntry::SessionInfo { .. } => false,
    }
}
