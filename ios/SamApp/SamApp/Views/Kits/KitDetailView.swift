import SwiftUI
import WebKit

struct KitDetailView: View {
    @Environment(AppViewModel.self) private var appVM
    let kit: KitInfo

    var body: some View {
        if kit.enabled, let url = appVM.kitVM.kitURL(for: kit) {
            KitWebView(url: url)
                .navigationTitle(kit.name)
                .navigationBarTitleDisplayMode(.inline)
        } else {
            ContentUnavailableView(
                "Kit Disabled",
                systemImage: "power",
                description: Text("\(kit.name) is currently disabled")
            )
            .navigationTitle(kit.name)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct KitWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Only reload if URL changed
        if webView.url != url {
            webView.load(URLRequest(url: url))
        }
    }
}
