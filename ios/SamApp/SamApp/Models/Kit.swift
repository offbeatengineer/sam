import Foundation

struct KitInfo: Identifiable, Hashable, Codable {
    let id: String
    let name: String
    let description: String
    let icon: String
    let version: String
    let enabled: Bool
}
