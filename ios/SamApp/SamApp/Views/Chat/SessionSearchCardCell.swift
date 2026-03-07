import SwiftUI

struct SessionSearchCardCell: View {
    let details: SessionSearchDetails2
    var onNavigate: ((String, Double) -> Void)?
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    expanded.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "bubble.left.and.text.bubble.right")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(details.query)
                        .font(.caption)
                        .fontWeight(.medium)
                        .lineLimit(1)
                    Spacer()
                    Text("\(details.results.count) \(details.results.count == 1 ? "result" : "results")")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.secondary.opacity(0.05))
            }
            .buttonStyle(.plain)

            if expanded {
                Divider()

                ForEach(Array(details.results.enumerated()), id: \.offset) { _, item in
                    Button {
                        onNavigate?(item.conversationId, item.timestamp)
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 4) {
                                Text(item.role)
                                    .font(.caption2)
                                    .fontWeight(.medium)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 1)
                                    .background(Color.secondary.opacity(0.1))
                                    .clipShape(RoundedRectangle(cornerRadius: 3))
                                Text(item.sessionName)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                Spacer()
                                Text(Self.relativeTime(item.timestamp))
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            Text(item.text)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)

                    if item.conversationId != details.results.last?.conversationId ||
                       item.timestamp != details.results.last?.timestamp {
                        Divider().padding(.leading, 12)
                    }
                }
            }
        }
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private static func relativeTime(_ ts: Double) -> String {
        // Timestamp is in ms since epoch
        let seconds = ts / 1000.0
        let diff = Date().timeIntervalSince1970 - seconds
        let mins = Int(diff / 60)
        if mins < 1 { return "just now" }
        if mins < 60 { return "\(mins)m ago" }
        let hrs = mins / 60
        if hrs < 24 { return "\(hrs)h ago" }
        let days = hrs / 24
        return "\(days)d ago"
    }
}
