import SwiftUI

struct ArtifactCardCell: View {
    let title: String
    var artifactPath: String? = nil
    @State private var showPreview = false
    @State private var showBrowser = false

    var body: some View {
        HStack {
            Button {
                if artifactPath != nil {
                    showPreview = true
                } else {
                    showBrowser = true
                }
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
                if let artifactPath {
                    NavigationStack {
                        ArtifactPreviewView(artifact: ArtifactFileEntry(
                            name: (artifactPath as NSString).lastPathComponent,
                            path: artifactPath,
                            size: nil,
                            isDirectory: false
                        ))
                    }
                }
            }
            .sheet(isPresented: $showBrowser) {
                NavigationStack {
                    ArtifactBrowserView()
                }
            }
        }
    }
}
