import Foundation

/// Manages WebSocket connection lifecycle with automatic reconnection.
@Observable
final class ConnectionManager: @unchecked Sendable {
    enum Status: Equatable {
        case disconnected
        case connecting
        case connected
        case reconnecting(attempt: Int)
        case error(String)
    }

    private(set) var status: Status = .disconnected
    private let client = WebSocketClient()
    private var messageStream: AsyncStream<ServerMessage>?
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var currentURL: URL?
    private var currentApiKey: String?
    private var messageHandler: ((ServerMessage) -> Void)?

    private static let minBackoff: TimeInterval = 2
    private static let maxBackoff: TimeInterval = 30
    private var reconnectAttempt = 0

    func connect(url: URL, apiKey: String?, onMessage: @escaping (ServerMessage) -> Void) {
        // Cancel local tasks but don't fire a background client.disconnect() —
        // client.connect() handles cleanup internally on the actor, avoiding a
        // race where a background disconnect cancels the newly created connection.
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        reconnectAttempt = 0

        currentURL = url
        currentApiKey = apiKey
        messageHandler = onMessage
        performConnect()
    }

    func disconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        reconnectAttempt = 0
        Task { await client.disconnect() }
        status = .disconnected
    }

    func send(_ request: ClientRequest) async throws {
        try await client.send(request)
    }

    // MARK: - Internal

    private func performConnect() {
        guard let url = currentURL else { return }
        status = reconnectAttempt > 0 ? .reconnecting(attempt: reconnectAttempt) : .connecting

        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            guard let self else { return }
            let stream = await client.connect(url: url, apiKey: currentApiKey)

            await MainActor.run { self.status = .connected; self.reconnectAttempt = 0 }

            for await message in stream {
                guard !Task.isCancelled else { break }
                await MainActor.run { self.messageHandler?(message) }
            }

            // Stream ended — attempt reconnect if not explicitly disconnected
            guard !Task.isCancelled else { return }
            await MainActor.run { self.scheduleReconnect() }
        }
    }

    private func scheduleReconnect() {
        guard currentURL != nil else { return }
        reconnectAttempt += 1
        let delay = min(
            Self.minBackoff * pow(2, Double(reconnectAttempt - 1)),
            Self.maxBackoff
        )
        status = .reconnecting(attempt: reconnectAttempt)

        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await MainActor.run { self?.performConnect() }
        }
    }
}
