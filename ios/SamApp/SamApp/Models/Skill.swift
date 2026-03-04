import Foundation

struct SkillInfo: Codable, Identifiable, Hashable {
    let filename: String
    let modified: String
    let size: Int

    var id: String { filename }

    var modifiedDate: Date {
        ISO8601DateFormatter().date(from: modified) ?? .distantPast
    }
}

struct SkillContent: Identifiable {
    let filename: String
    var content: String

    var id: String { filename }
}
