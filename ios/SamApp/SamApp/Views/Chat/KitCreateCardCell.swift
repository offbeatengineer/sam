import SwiftUI

struct KitCreateCardCell: View {
    let details: KitCreateDetails

    private var iconName: String {
        // Map kit icon names to SF Symbols
        switch details.icon {
        case "sparkles": return "sparkles"
        case "calculator": return "plus.forwardslash.minus"
        case "calendar": return "calendar"
        case "camera": return "camera"
        case "clock": return "clock"
        case "cloud": return "cloud"
        case "code": return "chevron.left.forwardslash.chevron.right"
        case "compass": return "safari"
        case "database": return "cylinder"
        case "globe": return "globe"
        case "heart": return "heart"
        case "home": return "house"
        case "image": return "photo"
        case "key": return "key"
        case "lightbulb": return "lightbulb"
        case "link": return "link"
        case "list": return "list.bullet"
        case "mail": return "envelope"
        case "map": return "map"
        case "message": return "message"
        case "mic": return "mic"
        case "music": return "music.note"
        case "notebook": return "book"
        case "palette": return "paintpalette"
        case "pen": return "pencil"
        case "puzzle": return "puzzlepiece"
        case "rocket": return "paperplane"
        case "search": return "magnifyingglass"
        case "shield": return "shield"
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

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: iconName)
                .font(.subheadline)
                .foregroundStyle(.blue)

            VStack(alignment: .leading, spacing: 3) {
                Text("Kit created")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(details.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                if !details.description.isEmpty {
                    Text(details.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 6) {
                    Text(details.kitId)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text("v\(details.version)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color.blue.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
