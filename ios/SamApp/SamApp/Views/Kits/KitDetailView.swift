import SwiftUI
import WebKit
import SafariServices

private extension UIView {
    func findViewController() -> UIViewController? {
        var responder: UIResponder? = self
        while let next = responder?.next {
            if let vc = next as? UIViewController { return vc }
            responder = next
        }
        return nil
    }
}

@Observable
final class KitBridgeState {
    var navTitle: String?
    var menuItems: [KitMenuItem] = []
    weak var webView: WKWebView?

    func triggerMenuAction(_ id: String) {
        let escaped = id.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        webView?.evaluateJavaScript("window.__kitMenuCallback?.('\(escaped)')") { _, _ in }
    }
}

struct KitMenuItem: Identifiable {
    let id: String
    let label: String
    let systemImage: String?
}

struct KitDetailView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var bridge = KitBridgeState()
    let kit: KitInfo

    var body: some View {
        if kit.enabled, let url = appVM.kitVM.kitURL(for: kit) {
            KitWebView(url: url, bridge: bridge)
                .navigationTitle(bridge.navTitle ?? kit.name)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    if bridge.menuItems.count == 1, let item = bridge.menuItems.first {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button {
                                bridge.triggerMenuAction(item.id)
                            } label: {
                                if let systemImage = item.systemImage {
                                    Image(systemName: systemImage)
                                } else {
                                    Text(item.label)
                                }
                            }
                            .accessibilityLabel(item.label)
                        }
                    } else if bridge.menuItems.count > 1 {
                        ToolbarItem(placement: .topBarTrailing) {
                            Menu {
                                ForEach(bridge.menuItems) { item in
                                    Button {
                                        bridge.triggerMenuAction(item.id)
                                    } label: {
                                        if let systemImage = item.systemImage {
                                            Label(item.label, systemImage: systemImage)
                                        } else {
                                            Text(item.label)
                                        }
                                    }
                                }
                            } label: {
                                Image(systemName: "ellipsis.circle")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
        } else {
            ContentUnavailableView(
                "Kit Disabled",
                systemImage: KitInfo.sfSymbol(for: kit.icon),
                description: Text("\(kit.name) is currently disabled")
            )
            .navigationTitle(kit.name)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct KitWebView: UIViewRepresentable {
    let url: URL
    let bridge: KitBridgeState

    func makeCoordinator() -> Coordinator {
        Coordinator(bridge: bridge)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "samKit")
        let webView = WKWebView(frame: .zero, configuration: config)
        bridge.webView = webView
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if webView.url != url {
            webView.load(URLRequest(url: url))
        }
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        let bridge: KitBridgeState

        init(bridge: KitBridgeState) {
            self.bridge = bridge
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }

            Task { @MainActor in
                switch type {
                case "setTitle":
                    if let title = body["title"] as? String {
                        bridge.navTitle = title
                    }
                case "setMenu":
                    if let items = body["items"] as? [[String: Any]] {
                        bridge.menuItems = items.compactMap { dict in
                            guard let id = dict["id"] as? String,
                                  let label = dict["label"] as? String else { return nil }
                            return KitMenuItem(
                                id: id,
                                label: label,
                                systemImage: dict["systemImage"] as? String
                            )
                        }
                    }
                case "openUrl":
                    if let urlString = body["url"] as? String,
                       let url = URL(string: urlString) {
                        let safari = SFSafariViewController(url: url)
                        bridge.webView?.findViewController()?.present(safari, animated: true)
                    }
                default:
                    break
                }
            }
        }
    }
}
