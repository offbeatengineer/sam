//! pi-coding-agent JSONL session entry types, mirrored from
//! `desktop/src/types/session.ts`. These arrive as raw JSON values inside the
//! `session_entries` response; parse each one with [`parse_entry`] so a single
//! unrecognized entry degrades to [`SessionEntry::Unknown`] instead of failing
//! the whole session load.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ======================== Content ========================

/// A single content item inside a message. One enum covers user, assistant and
/// tool-result content; each message role simply uses the variants it needs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ContentItem {
    #[serde(rename = "text")]
    Text {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "textSignature")]
        text_signature: Option<String>,
    },
    #[serde(rename = "thinking")]
    Thinking {
        thinking: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "thinkingSignature")]
        thinking_signature: Option<String>,
    },
    #[serde(rename = "image")]
    Image {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data: Option<String>,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    #[serde(rename = "audio_ref")]
    AudioRef { url: String },
    #[serde(rename = "toolCall")]
    ToolCall {
        id: String,
        name: String,
        #[serde(default)]
        arguments: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(rename = "thoughtSignature")]
        thought_signature: Option<String>,
    },
}

/// Message content that is either a plain string or a list of content items.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Items(Vec<ContentItem>),
}

impl MessageContent {
    /// Concatenated plain text of the content (ignores non-text items).
    pub fn plain_text(&self) -> String {
        match self {
            MessageContent::Text(s) => s.clone(),
            MessageContent::Items(items) => items
                .iter()
                .filter_map(|item| match item {
                    ContentItem::Text { text, .. } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n"),
        }
    }
}

// ======================== Usage ========================

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Usage {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub total_tokens: f64,
    pub cost: UsageCost,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct UsageCost {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub total: f64,
}

// ======================== Agent messages ========================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "role", rename_all = "camelCase")]
pub enum AgentMessage {
    #[serde(rename_all = "camelCase")]
    User {
        content: MessageContent,
        #[serde(default)]
        timestamp: f64,
    },
    #[serde(rename_all = "camelCase")]
    Assistant {
        content: Vec<ContentItem>,
        #[serde(default)]
        api: String,
        #[serde(default)]
        provider: String,
        #[serde(default)]
        model: String,
        #[serde(default)]
        usage: Usage,
        #[serde(default)]
        stop_reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error_message: Option<String>,
        #[serde(default)]
        timestamp: f64,
    },
    #[serde(rename_all = "camelCase")]
    ToolResult {
        tool_call_id: String,
        tool_name: String,
        content: Vec<ContentItem>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        details: Option<Value>,
        #[serde(default)]
        is_error: bool,
        #[serde(default)]
        timestamp: f64,
    },
    #[serde(rename_all = "camelCase")]
    BashExecution {
        command: String,
        #[serde(default)]
        output: String,
        #[serde(default)]
        exit_code: Option<i32>,
        #[serde(default)]
        cancelled: bool,
        #[serde(default)]
        truncated: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        full_output_path: Option<String>,
        #[serde(default)]
        timestamp: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exclude_from_context: Option<bool>,
    },
    #[serde(rename_all = "camelCase")]
    Custom {
        custom_type: String,
        content: MessageContent,
        #[serde(default)]
        display: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        details: Option<Value>,
        #[serde(default)]
        timestamp: f64,
    },
    #[serde(rename_all = "camelCase")]
    CompactionSummary {
        summary: String,
        #[serde(default)]
        tokens_before: f64,
        #[serde(default)]
        timestamp: f64,
    },
    #[serde(rename_all = "camelCase")]
    BranchSummary {
        summary: String,
        from_id: String,
        #[serde(default)]
        timestamp: f64,
    },
}

// ======================== Session entries ========================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEntry {
    #[serde(rename_all = "camelCase")]
    Message {
        id: String,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        timestamp: String,
        message: AgentMessage,
    },
    #[serde(rename_all = "camelCase")]
    ModelChange {
        id: String,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        timestamp: String,
        provider: String,
        model_id: String,
    },
    #[serde(rename_all = "camelCase")]
    ThinkingLevelChange {
        id: String,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        timestamp: String,
        thinking_level: String,
    },
    #[serde(rename_all = "camelCase")]
    Compaction {
        id: String,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        timestamp: String,
        summary: String,
        #[serde(default)]
        first_kept_entry_id: String,
        #[serde(default)]
        tokens_before: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        details: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_hook: Option<bool>,
    },
    #[serde(rename_all = "camelCase")]
    BranchSummary {
        id: String,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        timestamp: String,
        from_id: String,
        summary: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        details: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_hook: Option<bool>,
    },
    #[serde(rename_all = "camelCase")]
    CustomMessage {
        id: String,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        timestamp: String,
        custom_type: String,
        content: MessageContent,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        details: Option<Value>,
        #[serde(default)]
        display: bool,
    },
    #[serde(rename_all = "camelCase")]
    Custom {
        id: String,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        timestamp: String,
        custom_type: String,
        #[serde(default)]
        data: Option<Value>,
    },
    #[serde(rename_all = "camelCase")]
    Label {
        id: String,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        timestamp: String,
        target_id: String,
        #[serde(default)]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    SessionInfo {
        id: String,
        #[serde(default)]
        parent_id: Option<String>,
        #[serde(default)]
        timestamp: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
    /// Entry type this client doesn't recognize; carries the raw JSON for
    /// debugging/fallback display.
    #[serde(skip)]
    Unknown { raw: Value },
}

impl SessionEntry {
    pub fn id(&self) -> Option<&str> {
        use SessionEntry::*;
        match self {
            Message { id, .. }
            | ModelChange { id, .. }
            | ThinkingLevelChange { id, .. }
            | Compaction { id, .. }
            | BranchSummary { id, .. }
            | CustomMessage { id, .. }
            | Custom { id, .. }
            | Label { id, .. }
            | SessionInfo { id, .. } => Some(id),
            Unknown { raw } => raw.get("id").and_then(|v| v.as_str()),
        }
    }
}

/// Parse one raw JSONL entry, degrading to `Unknown` instead of erroring.
pub fn parse_entry(value: Value) -> SessionEntry {
    match serde_json::from_value::<SessionEntry>(value.clone()) {
        Ok(entry) => entry,
        Err(_) => SessionEntry::Unknown { raw: value },
    }
}

/// Session header line (first line of a session JSONL file).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionHeader {
    pub id: String,
    #[serde(default)]
    pub version: Option<u32>,
    #[serde(default)]
    pub timestamp: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_session: Option<String>,
}
