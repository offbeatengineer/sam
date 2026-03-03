import Foundation

// MARK: - Client → Server Requests

enum ClientRequest: Encodable {
    case chat(requestId: String, conversationId: String, text: String)
    case abort(conversationId: String)
    case closeSession(conversationId: String)
    case listSessions(requestId: String)
    case getSessionEntries(requestId: String, sessionPath: String)
    case renameSession(requestId: String, sessionPath: String, name: String)
    // Memory
    case memoryList(requestId: String, limit: Int?, offset: Int?)
    case memorySearch(requestId: String, query: String, limit: Int?, tags: [String]?)
    case memorySave(requestId: String, text: String, tags: [String]?, source: String?)
    case memoryUpdate(requestId: String, id: String, text: String, tags: [String]?)
    case memoryDelete(requestId: String, id: String)
    // Skills
    case listSkills(requestId: String)
    case getSkill(requestId: String, filename: String)
    case saveSkill(requestId: String, filename: String, content: String)
    case deleteSkill(requestId: String, filename: String)

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: DynamicCodingKey.self)

        switch self {
        case .chat(let requestId, let conversationId, let text):
            try container.encode("chat", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))
            try container.encode(conversationId, forKey: .key("conversationId"))
            try container.encode(text, forKey: .key("text"))

        case .abort(let conversationId):
            try container.encode("abort", forKey: .key("type"))
            try container.encode(conversationId, forKey: .key("conversationId"))

        case .closeSession(let conversationId):
            try container.encode("close_session", forKey: .key("type"))
            try container.encode(conversationId, forKey: .key("conversationId"))

        case .listSessions(let requestId):
            try container.encode("list_sessions", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))

        case .getSessionEntries(let requestId, let sessionPath):
            try container.encode("get_session_entries", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))
            try container.encode(sessionPath, forKey: .key("sessionPath"))

        case .renameSession(let requestId, let sessionPath, let name):
            try container.encode("rename_session", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))
            try container.encode(sessionPath, forKey: .key("sessionPath"))
            try container.encode(name, forKey: .key("name"))

        case .memoryList(let requestId, let limit, let offset):
            try container.encode("memory_list", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))
            try container.encodeIfPresent(limit, forKey: .key("limit"))
            try container.encodeIfPresent(offset, forKey: .key("offset"))

        case .memorySearch(let requestId, let query, let limit, let tags):
            try container.encode("memory_search", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))
            try container.encode(query, forKey: .key("query"))
            try container.encodeIfPresent(limit, forKey: .key("limit"))
            try container.encodeIfPresent(tags, forKey: .key("tags"))

        case .memorySave(let requestId, let text, let tags, let source):
            try container.encode("memory_save", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))
            try container.encode(text, forKey: .key("text"))
            try container.encodeIfPresent(tags, forKey: .key("tags"))
            try container.encodeIfPresent(source, forKey: .key("source"))

        case .memoryUpdate(let requestId, let id, let text, let tags):
            try container.encode("memory_update", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))
            try container.encode(id, forKey: .key("id"))
            try container.encode(text, forKey: .key("text"))
            try container.encodeIfPresent(tags, forKey: .key("tags"))

        case .memoryDelete(let requestId, let id):
            try container.encode("memory_delete", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))
            try container.encode(id, forKey: .key("id"))

        case .listSkills(let requestId):
            try container.encode("list_skills", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))

        case .getSkill(let requestId, let filename):
            try container.encode("get_skill", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))
            try container.encode(filename, forKey: .key("filename"))

        case .saveSkill(let requestId, let filename, let content):
            try container.encode("save_skill", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))
            try container.encode(filename, forKey: .key("filename"))
            try container.encode(content, forKey: .key("content"))

        case .deleteSkill(let requestId, let filename):
            try container.encode("delete_skill", forKey: .key("type"))
            try container.encode(requestId, forKey: .key("requestId"))
            try container.encode(filename, forKey: .key("filename"))
        }
    }
}

// MARK: - Server → Client Messages

enum ServerMessage: Decodable {
    // Turn lifecycle
    case turnStart(conversationId: String, requestId: String)
    case turnEnd(conversationId: String, requestId: String)
    // Streaming
    case textDelta(conversationId: String, delta: String, contentIndex: Int)
    case thinkingDelta(conversationId: String, delta: String, contentIndex: Int)
    case thinkingEnd(conversationId: String, contentIndex: Int)
    // Tool execution
    case toolStart(conversationId: String, toolCallId: String, toolName: String, args: AnyCodable)
    case toolUpdate(conversationId: String, toolCallId: String, toolName: String, partialResult: String)
    case toolEnd(conversationId: String, toolCallId: String, toolName: String, result: String, isError: Bool, details: AnyCodable?)
    // Session lifecycle
    case sessionCreated(conversationId: String)
    case sessionClosed(conversationId: String)
    case aborted(conversationId: String)
    case error(conversationId: String?, error: String)
    // Session browsing
    case sessionsList(requestId: String, sessions: [SessionInfo])
    case sessionEntries(requestId: String, header: AnyCodable?, entries: [AnyCodable])
    // Memory
    case memoryListResult(requestId: String, memories: [MemoryItem], total: Int)
    case memorySearchResult(requestId: String, memories: [MemoryItem], count: Int)
    case memorySaveResult(requestId: String, id: String, text: String, tags: [String])
    case memoryUpdateResult(requestId: String, success: Bool)
    case memoryDeleteResult(requestId: String, success: Bool)
    case memoryError(requestId: String, error: String)
    // Session mutation
    case renameSessionResult(requestId: String, success: Bool)
    // Skills
    case skillsListResult(requestId: String, skills: [SkillInfo])
    case skillContentResult(requestId: String, filename: String, content: String)
    case skillSaveResult(requestId: String, success: Bool)
    case skillDeleteResult(requestId: String, success: Bool)
    case skillError(requestId: String, error: String)
    // Artifacts
    case artifactsChanged(event: String, path: String)

    private enum CodingKeys: String, CodingKey {
        case type, conversationId, requestId, delta, contentIndex
        case toolCallId, toolName, args, partialResult, result, isError, details
        case error, sessions, header, entries
        case memories, total, count, id, text, tags, success
        case skills, filename, content
        case event, path
        case source
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "turn_start":
            self = .turnStart(
                conversationId: try container.decode(String.self, forKey: .conversationId),
                requestId: try container.decode(String.self, forKey: .requestId)
            )
        case "turn_end":
            self = .turnEnd(
                conversationId: try container.decode(String.self, forKey: .conversationId),
                requestId: try container.decode(String.self, forKey: .requestId)
            )
        case "text_delta":
            self = .textDelta(
                conversationId: try container.decode(String.self, forKey: .conversationId),
                delta: try container.decode(String.self, forKey: .delta),
                contentIndex: try container.decode(Int.self, forKey: .contentIndex)
            )
        case "thinking_delta":
            self = .thinkingDelta(
                conversationId: try container.decode(String.self, forKey: .conversationId),
                delta: try container.decode(String.self, forKey: .delta),
                contentIndex: try container.decode(Int.self, forKey: .contentIndex)
            )
        case "thinking_end":
            self = .thinkingEnd(
                conversationId: try container.decode(String.self, forKey: .conversationId),
                contentIndex: try container.decode(Int.self, forKey: .contentIndex)
            )
        case "tool_start":
            self = .toolStart(
                conversationId: try container.decode(String.self, forKey: .conversationId),
                toolCallId: try container.decode(String.self, forKey: .toolCallId),
                toolName: try container.decode(String.self, forKey: .toolName),
                args: try container.decode(AnyCodable.self, forKey: .args)
            )
        case "tool_update":
            self = .toolUpdate(
                conversationId: try container.decode(String.self, forKey: .conversationId),
                toolCallId: try container.decode(String.self, forKey: .toolCallId),
                toolName: try container.decode(String.self, forKey: .toolName),
                partialResult: try container.decode(String.self, forKey: .partialResult)
            )
        case "tool_end":
            self = .toolEnd(
                conversationId: try container.decode(String.self, forKey: .conversationId),
                toolCallId: try container.decode(String.self, forKey: .toolCallId),
                toolName: try container.decode(String.self, forKey: .toolName),
                result: try container.decode(String.self, forKey: .result),
                isError: try container.decode(Bool.self, forKey: .isError),
                details: try container.decodeIfPresent(AnyCodable.self, forKey: .details)
            )
        case "session_created":
            self = .sessionCreated(conversationId: try container.decode(String.self, forKey: .conversationId))
        case "session_closed":
            self = .sessionClosed(conversationId: try container.decode(String.self, forKey: .conversationId))
        case "aborted":
            self = .aborted(conversationId: try container.decode(String.self, forKey: .conversationId))
        case "error":
            self = .error(
                conversationId: try container.decodeIfPresent(String.self, forKey: .conversationId),
                error: try container.decode(String.self, forKey: .error)
            )
        case "sessions_list":
            self = .sessionsList(
                requestId: try container.decode(String.self, forKey: .requestId),
                sessions: try container.decode([SessionInfo].self, forKey: .sessions)
            )
        case "session_entries":
            self = .sessionEntries(
                requestId: try container.decode(String.self, forKey: .requestId),
                header: try container.decodeIfPresent(AnyCodable.self, forKey: .header),
                entries: try container.decode([AnyCodable].self, forKey: .entries)
            )
        case "memory_list_result":
            self = .memoryListResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                memories: try container.decode([MemoryItem].self, forKey: .memories),
                total: try container.decode(Int.self, forKey: .total)
            )
        case "memory_search_result":
            self = .memorySearchResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                memories: try container.decode([MemoryItem].self, forKey: .memories),
                count: try container.decode(Int.self, forKey: .count)
            )
        case "memory_save_result":
            self = .memorySaveResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                id: try container.decode(String.self, forKey: .id),
                text: try container.decode(String.self, forKey: .text),
                tags: try container.decode([String].self, forKey: .tags)
            )
        case "memory_update_result":
            self = .memoryUpdateResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                success: try container.decode(Bool.self, forKey: .success)
            )
        case "memory_delete_result":
            self = .memoryDeleteResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                success: try container.decode(Bool.self, forKey: .success)
            )
        case "memory_error":
            self = .memoryError(
                requestId: try container.decode(String.self, forKey: .requestId),
                error: try container.decode(String.self, forKey: .error)
            )
        case "rename_session_result":
            self = .renameSessionResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                success: try container.decode(Bool.self, forKey: .success)
            )
        case "skills_list_result":
            self = .skillsListResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                skills: try container.decode([SkillInfo].self, forKey: .skills)
            )
        case "skill_content_result":
            self = .skillContentResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                filename: try container.decode(String.self, forKey: .filename),
                content: try container.decode(String.self, forKey: .content)
            )
        case "skill_save_result":
            self = .skillSaveResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                success: try container.decode(Bool.self, forKey: .success)
            )
        case "skill_delete_result":
            self = .skillDeleteResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                success: try container.decode(Bool.self, forKey: .success)
            )
        case "skill_error":
            self = .skillError(
                requestId: try container.decode(String.self, forKey: .requestId),
                error: try container.decode(String.self, forKey: .error)
            )
        case "artifacts_changed":
            self = .artifactsChanged(
                event: try container.decode(String.self, forKey: .event),
                path: try container.decode(String.self, forKey: .path)
            )
        default:
            self = .error(conversationId: nil, error: "Unknown message type: \(type)")
        }
    }
}

// MARK: - Helpers

struct DynamicCodingKey: CodingKey {
    var stringValue: String
    var intValue: Int?

    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { self.intValue = intValue; self.stringValue = "\(intValue)" }

    static func key(_ name: String) -> DynamicCodingKey {
        DynamicCodingKey(stringValue: name)!
    }
}
