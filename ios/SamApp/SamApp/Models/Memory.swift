import Foundation

struct MemoryItem: Codable, Identifiable, Hashable {
    let id: String
    let text: String
    let tags: [String]
    let source: String
    let created_at: Double
    let score: Double

    var createdDate: Date {
        Date(timeIntervalSince1970: created_at / 1000)
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: MemoryItem, rhs: MemoryItem) -> Bool {
        lhs.id == rhs.id
    }
}
