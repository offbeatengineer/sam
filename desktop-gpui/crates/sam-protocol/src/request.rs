//! Requests sent from the app to sam. Mirrors `agent/src/protocol.ts` `AppRequest`.

use serde::{Deserialize, Serialize};

/// Attachment reference included in a chat request (file already uploaded via POST /upload).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachment {
    #[serde(rename = "type")]
    pub kind: AttachmentKind,
    /// Server-side file path from the upload response.
    pub path: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentKind {
    Image,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AppRequest {
    #[serde(rename_all = "camelCase")]
    Chat {
        request_id: String,
        conversation_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        attachments: Option<Vec<ChatAttachment>>,
    },
    #[serde(rename_all = "camelCase")]
    Abort { conversation_id: String },
    #[serde(rename_all = "camelCase")]
    CloseSession { conversation_id: String },

    // Session browsing
    #[serde(rename_all = "camelCase")]
    ListSessions { request_id: String },
    #[serde(rename_all = "camelCase")]
    GetSessionEntries {
        request_id: String,
        session_path: String,
    },
    #[serde(rename_all = "camelCase")]
    RenameSession {
        request_id: String,
        session_path: String,
        name: String,
    },

    // Session archiving
    #[serde(rename_all = "camelCase")]
    ArchiveSession {
        request_id: String,
        session_path: String,
    },
    #[serde(rename_all = "camelCase")]
    UnarchiveSession {
        request_id: String,
        session_path: String,
    },
    #[serde(rename_all = "camelCase")]
    ListArchivedSessions { request_id: String },

    // Memory management
    #[serde(rename_all = "camelCase")]
    MemoryList {
        request_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        offset: Option<u32>,
    },
    #[serde(rename_all = "camelCase")]
    MemorySearch {
        request_id: String,
        query: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tags: Option<Vec<String>>,
    },
    #[serde(rename_all = "camelCase")]
    MemorySave {
        request_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tags: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    MemoryUpdate {
        request_id: String,
        id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tags: Option<Vec<String>>,
    },
    #[serde(rename_all = "camelCase")]
    MemoryDelete { request_id: String, id: String },

    // Skill management
    #[serde(rename_all = "camelCase")]
    ListSkills { request_id: String },
    #[serde(rename_all = "camelCase")]
    GetSkill {
        request_id: String,
        filename: String,
    },
    #[serde(rename_all = "camelCase")]
    SaveSkill {
        request_id: String,
        filename: String,
        content: String,
    },
    #[serde(rename_all = "camelCase")]
    DeleteSkill {
        request_id: String,
        filename: String,
    },

    // Kit management
    #[serde(rename_all = "camelCase")]
    ListKits { request_id: String },
    #[serde(rename_all = "camelCase")]
    EnableKit { request_id: String, kit_id: String },
    #[serde(rename_all = "camelCase")]
    DisableKit { request_id: String, kit_id: String },
    #[serde(rename_all = "camelCase")]
    ReloadKit { request_id: String, kit_id: String },
    #[serde(rename_all = "camelCase")]
    DeleteKit { request_id: String, kit_id: String },

    // Session search
    #[serde(rename_all = "camelCase")]
    SessionSearch {
        request_id: String,
        query: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
    },
}

impl AppRequest {
    /// The `requestId` of this request, if it carries one (used for response correlation).
    pub fn request_id(&self) -> Option<&str> {
        use AppRequest::*;
        match self {
            Chat { request_id, .. }
            | ListSessions { request_id }
            | GetSessionEntries { request_id, .. }
            | RenameSession { request_id, .. }
            | ArchiveSession { request_id, .. }
            | UnarchiveSession { request_id, .. }
            | ListArchivedSessions { request_id }
            | MemoryList { request_id, .. }
            | MemorySearch { request_id, .. }
            | MemorySave { request_id, .. }
            | MemoryUpdate { request_id, .. }
            | MemoryDelete { request_id, .. }
            | ListSkills { request_id }
            | GetSkill { request_id, .. }
            | SaveSkill { request_id, .. }
            | DeleteSkill { request_id, .. }
            | ListKits { request_id }
            | EnableKit { request_id, .. }
            | DisableKit { request_id, .. }
            | ReloadKit { request_id, .. }
            | DeleteKit { request_id, .. }
            | SessionSearch { request_id, .. } => Some(request_id),
            Abort { .. } | CloseSession { .. } => None,
        }
    }
}
