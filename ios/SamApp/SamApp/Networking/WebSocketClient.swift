import Foundation

/// Actor-isolated WebSocket client using native URLSessionWebSocketTask.
actor WebSocketClient {
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var continuation: AsyncStream<ServerMessage>.Continuation?
    private var isReceiving = false

    /// Connect to the given URL with optional API key authentication.
    func connect(url: URL, apiKey: String?) -> AsyncStream<ServerMessage> {
        disconnect()

        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        session = URLSession(configuration: config)

        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        if let apiKey, !apiKey.isEmpty {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        let wsTask = session!.webSocketTask(with: request)
        self.task = wsTask

        let stream = AsyncStream<ServerMessage> { cont in
            self.continuation = cont
        }

        wsTask.resume()
        isReceiving = true
        Task { await receiveLoop() }

        return stream
    }

    func send(_ request: ClientRequest) async throws {
        guard let task, task.state == .running else {
            throw WebSocketError.notConnected
        }
        let data = try JSONEncoder().encode(request)
        let string = String(data: data, encoding: .utf8)!
        try await task.send(.string(string))
    }

    func disconnect() {
        isReceiving = false
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        continuation?.finish()
        continuation = nil
        session?.invalidateAndCancel()
        session = nil
    }

    var isConnected: Bool {
        task?.state == .running
    }

    // MARK: - Receive loop

    private func receiveLoop() async {
        guard let task else { return }

        while isReceiving {
            do {
                let message = try await task.receive()
                switch message {
                case .string(let text):
                    guard let data = text.data(using: .utf8) else { continue }
                    do {
                        let serverMessage = try JSONDecoder().decode(ServerMessage.self, from: data)
                        continuation?.yield(serverMessage)
                    } catch {
                        print("[WebSocket] Decode error: \(error)")
                    }
                case .data(let data):
                    do {
                        let serverMessage = try JSONDecoder().decode(ServerMessage.self, from: data)
                        continuation?.yield(serverMessage)
                    } catch {
                        print("[WebSocket] Decode error: \(error)")
                    }
                @unknown default:
                    break
                }
            } catch {
                if isReceiving {
                    print("[WebSocket] Receive error: \(error)")
                    isReceiving = false
                    continuation?.finish()
                }
                return
            }
        }
    }
}

enum WebSocketError: Error, LocalizedError {
    case notConnected
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .notConnected: return "WebSocket is not connected"
        case .encodingFailed: return "Failed to encode request"
        }
    }
}
