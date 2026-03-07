import SwiftUI

struct SessionReadCardCell: View {
    let details: SessionReadDetails
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
                    Text(details.sessionName.isEmpty ? "Session" : details.sessionName)
                        .font(.caption)
                        .fontWeight(.medium)
                        .lineLimit(1)
                    Spacer()
                    Text("\(details.messages.count) of \(details.totalMessages) messages")
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

                ForEach(Array(details.messages.enumerated()), id: \.offset) { _, msg in
                    Button {
                        onNavigate?(details.conversationId, msg.timestamp)
                    } label: {
                        HStack(alignment: .top, spacing: 6) {
                            Text(msg.role)
                                .font(.caption2)
                                .fontWeight(.medium)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(Color.secondary.opacity(0.1))
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                            Text(msg.text)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.plain)

                    if msg.timestamp != details.messages.last?.timestamp {
                        Divider().padding(.leading, 12)
                    }
                }
            }
        }
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
