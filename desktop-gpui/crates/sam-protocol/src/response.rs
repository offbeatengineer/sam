//! Responses sent from sam to the app. Mirrors `agent/src/protocol.ts` `AppResponse`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AppResponse {
    // Turn lifecycle
    #[serde(rename_all = "camelCase")]
    TurnStart {
        conversation_id: String,
        request_id: String,
    },
    #[serde(rename_all = "camelCase")]
    TurnEnd {
        conversation_id: String,
        request_id: String,
    },

    // Streaming text
    #[serde(rename_all = "camelCase")]
    TextDelta {
        conversation_id: String,
        delta: String,
        content_index: u32,
    },

    // Thinking
    #[serde(rename_all = "camelCase")]
    ThinkingDelta {
        conversation_id: String,
        delta: String,
        content_index: u32,
    },
    #[serde(rename_all = "camelCase")]
    ThinkingEnd {
        conversation_id: String,
        content_index: u32,
    },

    // Tool execution
    #[serde(rename_all = "camelCase")]
    ToolStart {
        conversation_id: String,
        tool_call_id: String,
        tool_name: String,
        args: Value,
    },
    #[serde(rename_all = "camelCase")]
    ToolUpdate {
        conversation_id: String,
        tool_call_id: String,
        tool_name: String,
        partial_result: String,
    },
    #[serde(rename_all = "camelCase")]
    ToolEnd {
        conversation_id: String,
        tool_call_id: String,
        tool_name: String,
        result: String,
        is_error: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        details: Option<Value>,
    },

    // Session lifecycle
    #[serde(rename_all = "camelCase")]
    SessionCreated { conversation_id: String },
    #[serde(rename_all = "camelCase")]
    SessionClosed { conversation_id: String },
    #[serde(rename_all = "camelCase")]
    Aborted { conversation_id: String },
    #[serde(rename_all = "camelCase")]
    Error {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        conversation_id: Option<String>,
        error: String,
    },

    // Session browsing responses
    #[serde(rename_all = "camelCase")]
    SessionsList {
        request_id: String,
        sessions: Vec<SessionInfoDto>,
    },
    #[serde(rename_all = "camelCase")]
    SessionEntries {
        request_id: String,
        header: Option<Value>,
        /// Raw JSONL entries; parse individually via `session::parse_entry`
        /// so one unknown entry never poisons the whole load.
        entries: Vec<Value>,
    },

    // Memory management responses
    #[serde(rename_all = "camelCase")]
    MemoryListResult {
        request_id: String,
        memories: Vec<MemoryResult>,
        total: u32,
    },
    #[serde(rename_all = "camelCase")]
    MemorySearchResult {
        request_id: String,
        memories: Vec<MemoryResult>,
        count: u32,
    },
    #[serde(rename_all = "camelCase")]
    MemorySaveResult {
        request_id: String,
        id: String,
        text: String,
        tags: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    MemoryUpdateResult { request_id: String, success: bool },
    #[serde(rename_all = "camelCase")]
    MemoryDeleteResult { request_id: String, success: bool },
    #[serde(rename_all = "camelCase")]
    MemoryError { request_id: String, error: String },

    // Session mutation
    #[serde(rename_all = "camelCase")]
    RenameSessionResult { request_id: String, success: bool },
    #[serde(rename_all = "camelCase")]
    ArchiveSessionResult { request_id: String, success: bool },
    #[serde(rename_all = "camelCase")]
    UnarchiveSessionResult { request_id: String, success: bool },
    #[serde(rename_all = "camelCase")]
    ArchivedSessionsList {
        request_id: String,
        sessions: Vec<SessionInfoDto>,
    },

    // Skill management responses
    #[serde(rename_all = "camelCase")]
    SkillsListResult {
        request_id: String,
        skills: Vec<SkillInfoDto>,
    },
    #[serde(rename_all = "camelCase")]
    SkillContentResult {
        request_id: String,
        filename: String,
        content: String,
    },
    #[serde(rename_all = "camelCase")]
    SkillSaveResult { request_id: String, success: bool },
    #[serde(rename_all = "camelCase")]
    SkillDeleteResult { request_id: String, success: bool },
    #[serde(rename_all = "camelCase")]
    SkillError { request_id: String, error: String },

    // Artifacts
    #[serde(rename_all = "camelCase")]
    ArtifactsChanged { event: String, path: String },

    // Kit management responses
    #[serde(rename_all = "camelCase")]
    KitsListResult {
        request_id: String,
        kits: Vec<KitInfoDto>,
    },
    #[serde(rename_all = "camelCase")]
    KitActionResult {
        request_id: String,
        success: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    KitsChanged { event: String, kit_id: String },

    // Session search
    #[serde(rename_all = "camelCase")]
    SessionSearchResult {
        request_id: String,
        results: Vec<SessionSearchResultDto>,
        count: u32,
    },

    /// Forward-compat: any message type this client doesn't know yet.
    #[serde(other)]
    Unknown,
}

impl AppResponse {
    /// The `requestId` this response correlates to, if any.
    pub fn request_id(&self) -> Option<&str> {
        use AppResponse::*;
        match self {
            TurnStart { request_id, .. }
            | TurnEnd { request_id, .. }
            | SessionsList { request_id, .. }
            | SessionEntries { request_id, .. }
            | MemoryListResult { request_id, .. }
            | MemorySearchResult { request_id, .. }
            | MemorySaveResult { request_id, .. }
            | MemoryUpdateResult { request_id, .. }
            | MemoryDeleteResult { request_id, .. }
            | MemoryError { request_id, .. }
            | RenameSessionResult { request_id, .. }
            | ArchiveSessionResult { request_id, .. }
            | UnarchiveSessionResult { request_id, .. }
            | ArchivedSessionsList { request_id, .. }
            | SkillsListResult { request_id, .. }
            | SkillContentResult { request_id, .. }
            | SkillSaveResult { request_id, .. }
            | SkillDeleteResult { request_id, .. }
            | SkillError { request_id, .. }
            | KitsListResult { request_id, .. }
            | KitActionResult { request_id, .. }
            | SessionSearchResult { request_id, .. } => Some(request_id),
            _ => None,
        }
    }

    /// The `conversationId` this response belongs to, if any.
    pub fn conversation_id(&self) -> Option<&str> {
        use AppResponse::*;
        match self {
            TurnStart { conversation_id, .. }
            | TurnEnd { conversation_id, .. }
            | TextDelta { conversation_id, .. }
            | ThinkingDelta { conversation_id, .. }
            | ThinkingEnd { conversation_id, .. }
            | ToolStart { conversation_id, .. }
            | ToolUpdate { conversation_id, .. }
            | ToolEnd { conversation_id, .. }
            | SessionCreated { conversation_id }
            | SessionClosed { conversation_id }
            | Aborted { conversation_id } => Some(conversation_id),
            Error {
                conversation_id, ..
            } => conversation_id.as_deref(),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/// Session metadata returned by `list_sessions`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfoDto {
    pub path: String,
    pub id: String,
    pub channel_id: String,
    pub conversation_id: String,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// ISO timestamp
    pub created: String,
    /// ISO timestamp
    pub modified: String,
    pub message_count: u32,
    pub first_message: String,
}

/// Skill metadata returned by `list_skills`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfoDto {
    pub filename: String,
    pub modified: String,
    pub size: u64,
}

/// Kit metadata returned by `list_kits`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KitInfoDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub version: String,
    pub enabled: bool,
}

/// Session search result. Wire format uses snake_case field names.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionSearchResultDto {
    pub text: String,
    pub role: String,
    pub score: f64,
    pub session_name: String,
    pub conversation_id: String,
    pub channel_id: String,
    /// Unix timestamp (ms)
    pub timestamp: f64,
}

/// Memory item. Wire format uses snake_case field names.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MemoryResult {
    pub id: String,
    pub text: String,
    pub tags: Vec<String>,
    pub source: String,
    /// Unix timestamp (ms)
    pub created_at: f64,
    pub score: f64,
}
