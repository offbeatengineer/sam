import Foundation

/// Where a reference note came from.
struct MemoryOrigin: Codable, Hashable {
    var url: String? = nil
    var tool: String? = nil
    var channelId: String? = nil
    var conversationId: String? = nil
    var timestamp: Double? = nil
}

struct MemoryItem: Codable, Identifiable, Hashable {
    let id: String
    let text: String
    let tags: [String]
    let source: String
    let created_at: Double
    let score: Double
    // Optional so that decoding still works against an agent that predates automatic memory.
    /// "profile" memories apply to every conversation; "situational" ones only when relevant.
    /// "knowledge" is a reference note Sam kept from research; it never becomes a profile memory.
    var kind: String? = nil
    /// "active", "superseded" (replaced by a newer memory), or "forgotten".
    var status: String? = nil
    var superseded_by: String? = nil
    var updated_at: Double? = nil
    var origin: MemoryOrigin? = nil

    var createdDate: Date {
        Date(timeIntervalSince1970: created_at / 1000)
    }

    var isActive: Bool { status == nil || status == "active" }
    var isProfile: Bool { kind == "profile" }
    var isKnowledge: Bool { kind == "knowledge" }
    /// Only web links are offered for opening.
    var originURL: URL? {
        guard let raw = origin?.url, let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
        return url
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: MemoryItem, rhs: MemoryItem) -> Bool {
        lhs.id == rhs.id
    }
}

/// What automatic memory did around a turn: recalled before it, saved or changed after it.
/// Arrives live as `memory_recalled` / `memory_written`, and in history as a
/// `memory_activity` custom session entry.
struct MemoryActivity: Codable, Hashable {
    struct Recalled: Codable, Hashable {
        let id: String
        let text: String
        var kind: String? = nil
        var p: Double? = nil
    }

    struct Replaced: Codable, Hashable {
        let id: String
        let text: String
    }

    struct Change: Codable, Hashable {
        let id: String
        let text: String
        var kind: String? = nil
        /// Set for superseded entries: the memory this one made outdated.
        var replaced: Replaced? = nil
    }

    /// "recall" or "write". Absent on the live `memory_written` message, where the type implies it.
    var phase: String? = nil
    var memories: [Recalled]? = nil
    var saved: [Change]? = nil
    var superseded: [Change]? = nil
    var duplicates: [Change]? = nil
    var forgotten: [Change]? = nil
    var flagged: [Change]? = nil
    var unresolvedForget: Bool? = nil

    var isRecall: Bool { phase == "recall" }

    /// Parse the `data` of a `memory_activity` custom session entry.
    static func from(entryData: [String: Any]) -> MemoryActivity? {
        guard JSONSerialization.isValidJSONObject(entryData),
              let data = try? JSONSerialization.data(withJSONObject: entryData) else { return nil }
        return try? JSONDecoder().decode(MemoryActivity.self, from: data)
    }
}
