import SwiftUI

struct ArtifactCardCell: View {
    let title: String
    @State private var showPreview = false

    var body: some View {
        HStack {
            Button {
                showPreview = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "doc.richtext")
                        .foregroundStyle(.blue)
                    Text(title)
                        .font(.subheadline)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .padding(10)
                .background(Color.blue.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .sheet(isPresented: $showPreview) {
                NavigationStack {
                    ArtifactBrowserView()
                }
            }
        }
    }
}
