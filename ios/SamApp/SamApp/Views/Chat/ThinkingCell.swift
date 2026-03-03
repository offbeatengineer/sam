import SwiftUI

struct ThinkingCell: View {
    let text: String
    let isDone: Bool
    @State private var opacity: Double = 0.5

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Image(systemName: "brain")
                        .font(.caption)
                    Text("Thinking")
                        .font(.caption.bold())
                }
                .foregroundStyle(.purple)

                Text(text)
                    .font(.subheadline)
                    .italic()
                    .foregroundStyle(.secondary)
                    .lineLimit(isDone ? nil : 10)
            }
            .padding(10)
            .background(Color.purple.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .opacity(isDone ? 1.0 : opacity)
            .onAppear {
                if !isDone {
                    withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
                        opacity = 1.0
                    }
                }
            }
            Spacer(minLength: 40)
        }
    }
}
