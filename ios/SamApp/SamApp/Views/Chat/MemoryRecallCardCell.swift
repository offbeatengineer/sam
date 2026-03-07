import SwiftUI

struct MemoryRecallCardCell: View {
    let details: MemoryRecallDetails
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
                    Image(systemName: "brain.head.profile")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(details.query)
                        .font(.caption)
                        .fontWeight(.medium)
                        .lineLimit(1)
                    Spacer()
                    Text("\(details.results.count) \(details.results.count == 1 ? "memory" : "memories")")
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
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 4) {
                            Text(String(item.id.prefix(8)))
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                            if let score = item.score {
                                Text("\(Int(score * 100))%")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        Text(item.text)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                        if !item.tags.isEmpty {
                            HStack(spacing: 4) {
                                ForEach(item.tags, id: \.self) { tag in
                                    Text(tag)
                                        .font(.caption2)
                                        .padding(.horizontal, 5)
                                        .padding(.vertical, 1)
                                        .background(Color.secondary.opacity(0.1))
                                        .foregroundStyle(.secondary)
                                        .clipShape(Capsule())
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)

                    if item.id != details.results.last?.id {
                        Divider().padding(.leading, 12)
                    }
                }
            }
        }
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
