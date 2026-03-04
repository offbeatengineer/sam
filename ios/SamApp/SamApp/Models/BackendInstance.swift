import Foundation

struct BackendInstance: Identifiable, Codable, Hashable {
    let id: UUID
    var name: String
    var serverURLString: String

    init(id: UUID = UUID(), name: String, serverURLString: String) {
        self.id = id
        self.name = name
        self.serverURLString = serverURLString
    }

    var serverURL: URL? {
        guard !serverURLString.isEmpty else { return nil }
        return URL(string: serverURLString)
    }

    var artifactsURL: URL? {
        guard let server = serverURL else { return nil }
        var components = URLComponents()
        components.scheme = server.scheme == "wss" ? "https" : "http"
        components.host = server.host
        components.port = server.port
        return components.url
    }
}
