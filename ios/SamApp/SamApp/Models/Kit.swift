import Foundation

struct KitInfo: Identifiable, Hashable, Codable {
    let id: String
    let name: String
    let description: String
    let icon: String
    let version: String
    let enabled: Bool

    /// Maps a canonical kit icon name to its SF Symbol equivalent.
    static func sfSymbol(for iconName: String) -> String {
        switch iconName {
        case "box": return "shippingbox"
        case "sparkles": return "sparkles"
        case "calculator": return "plusminus"
        case "calendar": return "calendar"
        case "camera": return "camera"
        case "chart-bar": return "chart.bar"
        case "chart-line": return "chart.xyaxis.line"
        case "chart-pie": return "chart.pie"
        case "check-list": return "checklist"
        case "clock": return "clock"
        case "cloud": return "cloud"
        case "code": return "chevron.left.forwardslash.chevron.right"
        case "coins": return "dollarsign.circle"
        case "compass": return "safari"
        case "database": return "cylinder"
        case "file-text": return "doc.text"
        case "folder": return "folder"
        case "gamepad": return "gamecontroller"
        case "globe": return "globe"
        case "graduation-cap": return "graduationcap"
        case "heart": return "heart"
        case "home": return "house"
        case "image": return "photo"
        case "inbox": return "tray"
        case "key": return "key"
        case "layers": return "square.3.layers.3d"
        case "lightbulb": return "lightbulb"
        case "link": return "link"
        case "list": return "list.bullet"
        case "mail": return "envelope"
        case "map": return "map"
        case "megaphone": return "megaphone"
        case "message": return "message"
        case "mic": return "mic"
        case "music": return "music.note"
        case "notebook": return "note.text"
        case "palette": return "paintpalette"
        case "pen": return "pencil"
        case "pizza": return "fork.knife"
        case "plane": return "airplane"
        case "puzzle": return "puzzlepiece"
        case "receipt": return "doc.plaintext"
        case "rocket": return "flame"
        case "search": return "magnifyingglass"
        case "shield": return "shield"
        case "shopping-cart": return "cart"
        case "star": return "star"
        case "sun": return "sun.max"
        case "tag": return "tag"
        case "timer": return "timer"
        case "trophy": return "trophy"
        case "users": return "person.2"
        case "wallet": return "wallet.bifold"
        case "wrench": return "wrench"
        case "zap": return "bolt"
        default: return "shippingbox"
        }
    }
}
