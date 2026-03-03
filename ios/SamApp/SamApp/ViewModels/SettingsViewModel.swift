import Foundation

@Observable
final class SettingsViewModel {
    var serverURLString: String {
        didSet { UserDefaults.standard.set(serverURLString, forKey: "sam_server_url") }
    }
    var artifactsURLString: String {
        didSet { UserDefaults.standard.set(artifactsURLString, forKey: "sam_artifacts_url") }
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

    var artifactsURL: URL? {
        guard !artifactsURLString.isEmpty else { return nil }
        return URL(string: artifactsURLString)
    }

    init() {
        self.serverURLString = UserDefaults.standard.string(forKey: "sam_server_url") ?? ""
        self.artifactsURLString = UserDefaults.standard.string(forKey: "sam_artifacts_url") ?? ""
        self.apiKey = KeychainHelper.load(key: "sam_api_key")
    }
}
