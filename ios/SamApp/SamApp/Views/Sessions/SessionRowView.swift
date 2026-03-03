import SwiftUI

struct SessionRowView: View {
    let session: SessionInfo
    let isStreaming: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(session.displayName)
                        .font(.body)
                        .lineLimit(1)

                    if session.isReadOnly {
                        Text("read-only")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(.quaternary)
                            .clipShape(Capsule())
                    }
                }

                HStack(spacing: 8) {
                    Text(session.modifiedDate, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Text("\(session.messageCount) messages")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if isStreaming {
                Circle()
                    .fill(.blue)
                    .frame(width: 8, height: 8)
            }

            channelDot
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var channelDot: some View {
        Circle()
            .fill(channelColor)
            .frame(width: 6, height: 6)
    }

    private var channelColor: Color {
        switch session.channelId {
        case "app": return .green
        case "discord": return .indigo
        case "pulse": return .orange
        default: return .gray
        }
    }
}
