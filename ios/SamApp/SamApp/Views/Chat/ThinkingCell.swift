import SwiftUI

struct ThinkingCell: View {
    let text: String
    let isDone: Bool
    @State private var opacity: Double = 0.5
    @State private var isExpanded = false

    private let collapsedLineCount = 3

    var body: some View {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        let isLong = lines.count > collapsedLineCount
        let remainingCount = lines.count - collapsedLineCount

        HStack {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Image(systemName: "brain")
                        .font(.caption)
                    Text(isDone ? "Thought" : "Thinking...")
                        .font(.caption.bold())
                }
                .foregroundStyle(.purple)

                Text(text)
                    .font(.subheadline)
                    .italic()
                    .foregroundStyle(isExpanded ? .primary : .secondary)
                    .lineLimit(isExpanded ? nil : collapsedLineCount)

                if isLong && !isExpanded {
                    Text("... (\(remainingCount) more lines)")
                        .font(.caption)
                        .foregroundStyle(.secondary.opacity(0.6))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color.purple.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .contentShape(Rectangle())
            .onTapGesture { isExpanded.toggle() }
            .opacity(isDone ? 1.0 : opacity)
            .onAppear {
                if !isDone {
                    withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
                        opacity = 1.0
                    }
                }
            }
        }
        .transaction { $0.animation = nil }
    }
}
