import Foundation

struct SessionInfo: Codable, Identifiable, Hashable {
    let path: String
    let id: String
    let channelId: String
    let conversationId: String
    let cwd: String
    let name: String?
    let created: String
    let modified: String
    let messageCount: Int
    let firstMessage: String

    var displayName: String {
        name ?? firstMessage.prefix(50).description.ifEmpty("Untitled")
    }

    var modifiedDate: Date {
        ISO8601DateFormatter().date(from: modified) ?? .distantPast
    }

    var isReadOnly: Bool {
        channelId == "discord" || channelId == "pulse"
    }
}

// MARK: - Session entry (mirrors pi-coding-agent JSONL format)

struct SessionEntry: Identifiable {
    let id: String          // entry.id from JSONL
    let entryType: String   // "message", "model_change", "compaction", etc.
    let message: AgentMessage?
    let timestamp: String?

    // For non-message entries
    let modelId: String?
    let summary: String?
}

// MARK: - Agent message (role-based, mirrors pi-coding-agent types)

/// Image attachment parsed from a user message content array.
struct UserImageAttachment {
    let mediaType: String       // e.g. "image/jpeg"
    let data: Data?             // decoded from inline base64 (nil if remote)
    let remotePath: String?     // relative URL path e.g. "/uploads/2025-03-03/abc.jpg" (nil if inline)
}

/// Audio attachment reference parsed from a user message content array.
struct UserAudioAttachment {
    let remotePath: String      // e.g. "/uploads/2025-03-03/abc.aac"
}

struct SessionUsage {
    var input: Int = 0
    var output: Int = 0
    var cacheRead: Int = 0
    var cacheWrite: Int = 0
    var costTotal: Double = 0
}

enum AgentMessage {
    case user(content: String, images: [UserImageAttachment], audioAttachments: [UserAudioAttachment])
    case assistant(content: [AssistantContentBlock], model: String?, provider: String?, usage: SessionUsage?)
    case toolResult(toolCallId: String, toolName: String, content: String, isError: Bool, details: AnyCodable?)
    case bashExecution(command: String, output: String, exitCode: Int?)
    case compactionSummary(summary: String)
    case other
}

enum AssistantContentBlock: Identifiable {
    case text(String)
    case thinking(String)
    case toolCall(id: String, name: String, arguments: AnyCodable)

    var id: String {
        switch self {
        case .text(let t): return "text-\(t.hashValue)"
        case .thinking(let t): return "thinking-\(t.hashValue)"
        case .toolCall(let id, _, _): return "toolCall-\(id)"
        }
    }
}

// MARK: - Parsing from raw JSON entries

extension SessionEntry {
    static func parse(from raw: AnyCodable) -> SessionEntry? {
        guard let dict = raw.value as? [String: Any] else { return nil }
        let entryType = dict["type"] as? String ?? "unknown"
        let entryId = dict["id"] as? String ?? UUID().uuidString
        let timestamp = dict["timestamp"] as? String

        switch entryType {
        case "message":
            guard let msgDict = dict["message"] as? [String: Any] else { return nil }
            let message = parseAgentMessage(msgDict)
            return SessionEntry(
                id: entryId, entryType: entryType, message: message,
                timestamp: timestamp, modelId: nil, summary: nil
            )

        case "model_change":
            return SessionEntry(
                id: entryId, entryType: entryType, message: nil,
                timestamp: timestamp, modelId: dict["modelId"] as? String, summary: nil
            )

        case "compaction":
            return SessionEntry(
                id: entryId, entryType: entryType, message: nil,
                timestamp: timestamp, modelId: nil, summary: dict["summary"] as? String
            )

        case "custom":
            let customType = dict["customType"] as? String
            if customType == "audio_attachment",
               let data = dict["data"] as? [String: Any],
               let url = data["url"] as? String {
                return SessionEntry(
                    id: entryId, entryType: entryType,
                    message: .user(content: "", images: [], audioAttachments: [UserAudioAttachment(remotePath: url)]),
                    timestamp: timestamp, modelId: nil, summary: nil
                )
            }
            return nil

        default:
            return SessionEntry(
                id: entryId, entryType: entryType, message: nil,
                timestamp: timestamp, modelId: nil, summary: nil
            )
        }
    }

    private static func parseAgentMessage(_ msg: [String: Any]) -> AgentMessage {
        let role = msg["role"] as? String ?? ""

        switch role {
        case "user":
            if let contentStr = msg["content"] as? String {
                return .user(content: contentStr, images: [], audioAttachments: [])
            } else if let contentArr = msg["content"] as? [[String: Any]] {
                let text = contentArr
                    .filter { ($0["type"] as? String) == "text" }
                    .compactMap { $0["text"] as? String }
                    .joined(separator: "\n")
                var images: [UserImageAttachment] = []
                for part in contentArr where (part["type"] as? String) == "image" {
                    let mediaType = part["mimeType"] as? String
                        ?? part["media_type"] as? String
                        ?? "image/jpeg"
                    if let urlPath = part["url"] as? String {
                        images.append(UserImageAttachment(mediaType: mediaType, data: nil, remotePath: urlPath))
                    } else if let base64Str = part["data"] as? String,
                              let data = Data(base64Encoded: base64Str) {
                        images.append(UserImageAttachment(mediaType: mediaType, data: data, remotePath: nil))
                    }
                }
                var audioAttachments: [UserAudioAttachment] = []
                for part in contentArr where (part["type"] as? String) == "audio_ref" {
                    if let urlPath = part["url"] as? String {
                        audioAttachments.append(UserAudioAttachment(remotePath: urlPath))
                    }
                }
                return .user(content: text, images: images, audioAttachments: audioAttachments)
            }
            return .user(content: "", images: [], audioAttachments: [])

        case "assistant":
            var blocks: [AssistantContentBlock] = []
            if let contentArr = msg["content"] as? [[String: Any]] {
                for part in contentArr {
                    let partType = part["type"] as? String ?? ""
                    switch partType {
                    case "text":
                        if let text = part["text"] as? String, !text.isEmpty {
                            blocks.append(.text(text))
                        }
                    case "thinking":
                        if let text = part["thinking"] as? String, !text.isEmpty {
                            blocks.append(.thinking(text))
                        }
                    case "toolCall":
                        let id = part["id"] as? String ?? UUID().uuidString
                        let name = part["name"] as? String ?? ""
                        let arguments = part["arguments"] as Any
                        blocks.append(.toolCall(id: id, name: name, arguments: AnyCodable(arguments)))
                    default:
                        break
                    }
                }
            }
            let model = msg["model"] as? String
            let provider = msg["provider"] as? String
            var usage: SessionUsage?
            if let u = msg["usage"] as? [String: Any] {
                var su = SessionUsage()
                su.input = u["input"] as? Int ?? 0
                su.output = u["output"] as? Int ?? 0
                su.cacheRead = u["cacheRead"] as? Int ?? 0
                su.cacheWrite = u["cacheWrite"] as? Int ?? 0
                if let cost = u["cost"] as? [String: Any] {
                    su.costTotal = cost["total"] as? Double ?? 0
                }
                usage = su
            }
            return .assistant(content: blocks, model: model, provider: provider, usage: usage)

        case "toolResult":
            let toolCallId = msg["toolCallId"] as? String ?? ""
            let toolName = msg["toolName"] as? String ?? ""
            let isError = msg["isError"] as? Bool ?? false
            let details = msg["details"].map { AnyCodable($0) }

            // content is an array of TextContent/ImageContent
            var text = ""
            if let contentArr = msg["content"] as? [[String: Any]] {
                text = contentArr
                    .filter { ($0["type"] as? String) == "text" }
                    .compactMap { $0["text"] as? String }
                    .joined(separator: "\n")
            } else if let contentStr = msg["content"] as? String {
                text = contentStr
            }

            return .toolResult(toolCallId: toolCallId, toolName: toolName, content: text, isError: isError, details: details)

        case "bashExecution":
            let command = msg["command"] as? String ?? ""
            let output = msg["output"] as? String ?? ""
            let exitCode = msg["exitCode"] as? Int
            return .bashExecution(command: command, output: output, exitCode: exitCode)

        case "compactionSummary", "branchSummary":
            let summary = msg["summary"] as? String ?? ""
            return .compactionSummary(summary: summary)

        default:
            return .other
        }
    }
}

// MARK: - String helpers

private extension String {
    func ifEmpty(_ fallback: String) -> String {
        isEmpty ? fallback : self
    }
}

private extension Substring {
    var description: String { String(self) }
}
