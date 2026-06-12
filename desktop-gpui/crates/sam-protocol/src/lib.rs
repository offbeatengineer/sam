//! Wire types for the Sam app channel (WebSocket on :9222).
//!
//! Canonical source: `agent/src/protocol.ts`. Session entry types mirror the
//! pi-coding-agent JSONL format (`desktop/src/types/session.ts`).

mod request;
mod response;
pub mod session;

pub use request::{AppRequest, AttachmentKind, ChatAttachment};
pub use response::{
    AppResponse, KitInfoDto, MemoryResult, SessionInfoDto, SessionSearchResultDto, SkillInfoDto,
};

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn roundtrip_request(req: &AppRequest) -> Value {
        serde_json::to_value(req).unwrap()
    }

    #[test]
    fn chat_request_wire_format() {
        let req = AppRequest::Chat {
            request_id: "r1".into(),
            conversation_id: "c1".into(),
            text: "hello".into(),
            attachments: Some(vec![ChatAttachment {
                kind: AttachmentKind::Image,
                path: "/tmp/x.jpg".into(),
                mime_type: "image/jpeg".into(),
            }]),
        };
        assert_eq!(
            roundtrip_request(&req),
            json!({
                "type": "chat",
                "requestId": "r1",
                "conversationId": "c1",
                "text": "hello",
                "attachments": [{"type": "image", "path": "/tmp/x.jpg", "mimeType": "image/jpeg"}]
            })
        );
    }

    #[test]
    fn chat_request_omits_empty_attachments() {
        let req = AppRequest::Chat {
            request_id: "r1".into(),
            conversation_id: "c1".into(),
            text: "hello".into(),
            attachments: None,
        };
        let v = roundtrip_request(&req);
        assert!(v.get("attachments").is_none());
    }

    #[test]
    fn request_type_tags_match_protocol_ts() {
        let cases: Vec<(AppRequest, &str)> = vec![
            (
                AppRequest::Abort {
                    conversation_id: "c".into(),
                },
                "abort",
            ),
            (
                AppRequest::CloseSession {
                    conversation_id: "c".into(),
                },
                "close_session",
            ),
            (
                AppRequest::ListSessions {
                    request_id: "r".into(),
                },
                "list_sessions",
            ),
            (
                AppRequest::GetSessionEntries {
                    request_id: "r".into(),
                    session_path: "/p".into(),
                },
                "get_session_entries",
            ),
            (
                AppRequest::MemorySearch {
                    request_id: "r".into(),
                    query: "q".into(),
                    limit: None,
                    tags: None,
                },
                "memory_search",
            ),
            (
                AppRequest::EnableKit {
                    request_id: "r".into(),
                    kit_id: "k".into(),
                },
                "enable_kit",
            ),
            (
                AppRequest::SessionSearch {
                    request_id: "r".into(),
                    query: "q".into(),
                    limit: Some(5),
                },
                "session_search",
            ),
        ];
        for (req, tag) in cases {
            let v = roundtrip_request(&req);
            assert_eq!(v["type"], tag, "wrong tag for {req:?}");
        }
    }

    #[test]
    fn session_path_field_is_camel_case() {
        let v = roundtrip_request(&AppRequest::RenameSession {
            request_id: "r".into(),
            session_path: "/p".into(),
            name: "n".into(),
        });
        assert_eq!(v["sessionPath"], "/p");
        assert_eq!(v["requestId"], "r");
    }

    #[test]
    fn parses_streaming_responses() {
        let frames = [
            json!({"type": "turn_start", "conversationId": "c1", "requestId": "r1"}),
            json!({"type": "text_delta", "conversationId": "c1", "delta": "hi", "contentIndex": 0}),
            json!({"type": "thinking_delta", "conversationId": "c1", "delta": "hm", "contentIndex": 1}),
            json!({"type": "thinking_end", "conversationId": "c1", "contentIndex": 1}),
            json!({"type": "tool_start", "conversationId": "c1", "toolCallId": "t1", "toolName": "bash", "args": {"cmd": "ls"}}),
            json!({"type": "tool_update", "conversationId": "c1", "toolCallId": "t1", "toolName": "bash", "partialResult": "a.txt"}),
            json!({"type": "tool_end", "conversationId": "c1", "toolCallId": "t1", "toolName": "bash", "result": "a.txt\n", "isError": false}),
            json!({"type": "turn_end", "conversationId": "c1", "requestId": "r1"}),
            json!({"type": "aborted", "conversationId": "c1"}),
            json!({"type": "error", "error": "boom"}),
        ];
        for frame in frames {
            let parsed: AppResponse = serde_json::from_value(frame.clone()).unwrap();
            assert!(
                !matches!(parsed, AppResponse::Unknown),
                "frame parsed as Unknown: {frame}"
            );
            if frame.get("conversationId").is_some() {
                assert_eq!(parsed.conversation_id(), Some("c1"));
            }
        }
    }

    #[test]
    fn unknown_response_type_degrades_gracefully() {
        let parsed: AppResponse =
            serde_json::from_value(json!({"type": "totally_new_thing", "x": 1})).unwrap();
        assert!(matches!(parsed, AppResponse::Unknown));
    }

    #[test]
    fn parses_sessions_list() {
        let v = json!({
            "type": "sessions_list",
            "requestId": "r2",
            "sessions": [{
                "path": "/home/u/.sam/sessions/app/c1/s.jsonl",
                "id": "s1",
                "channelId": "app",
                "conversationId": "c1",
                "cwd": "/home/u",
                "name": "My session",
                "created": "2026-06-01T00:00:00Z",
                "modified": "2026-06-02T00:00:00Z",
                "messageCount": 12,
                "firstMessage": "hello"
            }]
        });
        let parsed: AppResponse = serde_json::from_value(v).unwrap();
        let AppResponse::SessionsList { sessions, .. } = parsed else {
            panic!("wrong variant");
        };
        assert_eq!(sessions[0].channel_id, "app");
        assert_eq!(sessions[0].message_count, 12);
        assert_eq!(parsedless_name(&sessions[0]), "My session");

        fn parsedless_name(s: &SessionInfoDto) -> &str {
            s.name.as_deref().unwrap_or("")
        }
    }

    #[test]
    fn parses_session_entries_with_unknown_entry() {
        use session::{parse_entry, AgentMessage, SessionEntry};
        let entries = vec![
            json!({
                "type": "message",
                "id": "e1",
                "parentId": null,
                "timestamp": "2026-06-01T00:00:00Z",
                "message": {"role": "user", "content": "hi", "timestamp": 1750000000000u64}
            }),
            json!({
                "type": "message",
                "id": "e2",
                "parentId": "e1",
                "timestamp": "2026-06-01T00:00:01Z",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "thinking", "thinking": "hmm"},
                        {"type": "text", "text": "hello!"},
                        {"type": "toolCall", "id": "t1", "name": "bash", "arguments": {"cmd": "ls"}}
                    ],
                    "api": "anthropic", "provider": "anthropic", "model": "m",
                    "usage": {"input": 1, "output": 2, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 3,
                              "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}},
                    "stopReason": "end_turn",
                    "timestamp": 1750000001000u64
                }
            }),
            json!({
                "type": "message",
                "id": "e3",
                "parentId": "e2",
                "timestamp": "t",
                "message": {"role": "bashExecution", "command": "ls", "output": "a\n", "exitCode": 0,
                             "cancelled": false, "truncated": false, "timestamp": 0}
            }),
            json!({"type": "some_future_entry", "id": "e4", "weird": true}),
        ];
        let parsed: Vec<SessionEntry> = entries.into_iter().map(parse_entry).collect();
        assert!(matches!(
            &parsed[0],
            SessionEntry::Message {
                message: AgentMessage::User { .. },
                ..
            }
        ));
        assert!(matches!(
            &parsed[1],
            SessionEntry::Message {
                message: AgentMessage::Assistant { .. },
                ..
            }
        ));
        assert!(matches!(
            &parsed[2],
            SessionEntry::Message {
                message: AgentMessage::BashExecution {
                    exit_code: Some(0),
                    ..
                },
                ..
            }
        ));
        assert!(matches!(&parsed[3], SessionEntry::Unknown { .. }));
        assert_eq!(parsed[3].id(), Some("e4"));
    }

    #[test]
    fn user_content_string_or_items() {
        use session::{AgentMessage, ContentItem, MessageContent};
        let m: AgentMessage = serde_json::from_value(json!({
            "role": "user",
            "content": [
                {"type": "text", "text": "look"},
                {"type": "image", "mimeType": "image/png", "url": "/uploads/x.png"},
                {"type": "audio_ref", "url": "/uploads/y.wav"}
            ],
            "timestamp": 0
        }))
        .unwrap();
        let AgentMessage::User { content, .. } = m else {
            panic!()
        };
        let MessageContent::Items(items) = &content else {
            panic!()
        };
        assert!(matches!(items[1], ContentItem::Image { .. }));
        assert!(matches!(items[2], ContentItem::AudioRef { .. }));
        assert_eq!(content.plain_text(), "look");
    }
}
