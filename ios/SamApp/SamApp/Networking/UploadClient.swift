import Foundation

struct UploadResponse: Decodable {
    let id: String
    let path: String
    let mimeType: String
}

enum UploadError: Error, LocalizedError {
    case noBaseURL
    case serverError(String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .noBaseURL: return "Server URL not configured"
        case .serverError(let msg): return msg
        case .invalidResponse: return "Invalid server response"
        }
    }
}

enum UploadClient {
    /// Uploads file data to the server's /upload endpoint.
    static func upload(data: Data, mimeType: String, baseURL: URL, apiKey: String?) async throws -> UploadResponse {
        let url = baseURL.appendingPathComponent("upload")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        if let apiKey, !apiKey.isEmpty {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        let (responseData, httpResponse) = try await URLSession.shared.upload(for: request, from: data)

        guard let http = httpResponse as? HTTPURLResponse else {
            throw UploadError.invalidResponse
        }

        if http.statusCode != 200 {
            if let body = try? JSONDecoder().decode([String: String].self, from: responseData),
               let error = body["error"] {
                throw UploadError.serverError(error)
            }
            throw UploadError.serverError("Upload failed with status \(http.statusCode)")
        }

        return try JSONDecoder().decode(UploadResponse.self, from: responseData)
    }
}
