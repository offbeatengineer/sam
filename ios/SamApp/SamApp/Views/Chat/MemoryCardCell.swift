import SwiftUI

struct MemoryCardCell: View {
    let details: MemoryCardDetails

    private var actionLabel: String {
        switch details.action {
        case "saved": return "Memory saved"
        case "updated": return "Memory updated"
        case "forgotten": return "Memory forgotten"
        default: return "Memory \(details.action)"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "brain.head.profile")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(actionLabel)
                        .font(.caption)
                        .fontWeight(.medium)

                    Text(String(details.id.prefix(8)))
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }

                if let text = details.text, !text.isEmpty {
                    Text(text)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                if !details.tags.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(details.tags, id: \.self) { tag in
                            Text(tag)
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.1))
                                .foregroundStyle(.secondary)
                                .clipShape(Capsule())
                        }
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
