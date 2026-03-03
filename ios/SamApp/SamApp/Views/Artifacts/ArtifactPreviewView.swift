import SwiftUI
import WebKit

struct ArtifactPreviewView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.dismiss) private var dismiss
    let artifact: ArtifactFileEntry

    var body: some View {
        Group {
            if let url = appVM.artifactVM.artifactURL(for: artifact) {
                if artifact.isImage {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .empty:
                            ProgressView()
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFit()
                        case .failure:
                            ContentUnavailableView("Failed to load image", systemImage: "photo")
                        @unknown default:
                            EmptyView()
                        }
                    }
                } else if artifact.isHTML {
                    WebView(url: url)
                } else {
                    CodePreviewView(url: url)
                }
            } else {
                ContentUnavailableView("No URL available", systemImage: "exclamationmark.triangle")
            }
        }
        .navigationTitle(artifact.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Done") { dismiss() }
            }
        }
    }
}

// MARK: - WKWebView wrapper

struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

// MARK: - Code preview (text file)

struct CodePreviewView: View {
    let url: URL
    @State private var content: String?
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let content {
                ScrollView([.horizontal, .vertical]) {
                    Text(content)
                        .font(.system(.body, design: .monospaced))
                        .padding()
                }
            } else {
                ContentUnavailableView("Failed to load", systemImage: "doc")
            }
        }
        .task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                content = String(data: data, encoding: .utf8)
            } catch {
                content = nil
            }
            isLoading = false
        }
    }
}
