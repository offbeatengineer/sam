import SwiftUI

struct SlideToCancelText: View {
    var text: String
    @State private var animate: Bool = false
    var body: some View {
        ViewContent()
            .foregroundStyle(.gray.secondary)
            .overlay {
                ViewContent()
                    .foregroundStyle(.primary)
                    .mask {
                        GeometryReader {
                            let size = $0.size

                            Rectangle()
                                .frame(width: 15, height: size.width)
                                .blur(radius: 5)
                                .frame(maxWidth: .infinity, alignment: .trailing)
                                .offset(x: animate ? -size.width * 1.1 : 30)
                        }
                    }
            }
            .compositingGroup()
            .onAppear {
                guard !animate else { return }
                withAnimation(.linear(duration: 3).repeatForever(autoreverses: false)) {
                    animate = true
                }
            }
    }

    @ViewBuilder
    func ViewContent() -> some View {
        HStack(spacing: 5) {
            Image(systemName: "chevron.left")
                .font(.caption)

            Text(text)
                .font(.callout)
        }
    }
}
