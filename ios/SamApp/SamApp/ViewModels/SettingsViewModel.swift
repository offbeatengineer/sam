import Foundation

@Observable
final class SettingsViewModel {
    var serverURLString: String {
        didSet { UserDefaults.standard.set(serverURLString, forKey: "sam_server_url") }
    }
    var apiKey: String? {
        didSet {
            if let key = apiKey, !key.isEmpty {
                KeychainHelper.save(key: "sam_api_key", value: key)
            } else {
                KeychainHelper.delete(key: "sam_api_key")
            }
        }
    }

    var serverURL: URL? {
        guard !serverURLString.isEmpty else { return nil }
        return URL(string: serverURLString)
    }

    /// Derives the artifacts base URL from the server URL (same host:port, http/https scheme).
    var artifactsURL: URL? {
        guard let server = serverURL else { return nil }
        var components = URLComponents()
        components.scheme = server.scheme == "wss" ? "https" : "http"
        components.host = server.host
        components.port = server.port
        return components.url
    }

    init() {
        self.serverURLString = UserDefaults.standard.string(forKey: "sam_server_url") ?? ""
        self.apiKey = KeychainHelper.load(key: "sam_api_key")
    }
}
