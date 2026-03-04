import Foundation

/// Manages WebSocket connection lifecycle with automatic reconnection.
///
/// MainActor-isolated to serialize all state access and prevent data races.
/// Connect/disconnect are async to ensure proper sequencing of socket operations.
@MainActor @Observable
final class ConnectionManager {
    enum Status: Equatable {
        case disconnected
        case connecting
        case connected
        case reconnecting(attempt: Int)
        case error(String)
    }

    private(set) var status: Status = .disconnected
    private let client = WebSocketClient()
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var currentURL: URL?
    private var currentApiKey: String?
    private var messageHandler: ((ServerMessage) -> Void)?
    private var connectedHandler: (() -> Void)?
    private var disconnectHandler: (() -> Void)?

    private static let minBackoff: TimeInterval = 2
    private static let maxBackoff: TimeInterval = 30
    private var reconnectAttempt = 0

    /// Connect to the given URL. Tears down any existing connection first.
    func connect(url: URL, apiKey: String?, onConnected: (() -> Void)? = nil, onDisconnect: (() -> Void)? = nil, onMessage: @escaping (ServerMessage) -> Void) async {
        await tearDown()

        currentURL = url
        currentApiKey = apiKey
        connectedHandler = onConnected
        disconnectHandler = onDisconnect
        messageHandler = onMessage
        startReceiveLoop()
    }

    /// Disconnect and clean up.
    func disconnect() async {
        await tearDown()
        status = .disconnected
    }

    nonisolated func send(_ request: ClientRequest) async throws {
        try await client.send(request)
    }

    // MARK: - Internal

    private func tearDown() async {
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        reconnectAttempt = 0
        connectedHandler = nil
        disconnectHandler = nil
        messageHandler = nil
        currentURL = nil
        await client.disconnect()
    }

    private func startReceiveLoop() {
        guard let url = currentURL else { return }
        status = reconnectAttempt > 0 ? .reconnecting(attempt: reconnectAttempt) : .connecting

        receiveTask = Task { [weak self] in
            guard let self else { return }
            let stream = await client.connect(url: url, apiKey: currentApiKey)

            guard !Task.isCancelled else { return }
            status = .connected
            reconnectAttempt = 0
            connectedHandler?()

            for await message in stream {
                guard !Task.isCancelled else { break }
                messageHandler?(message)
            }

            guard !Task.isCancelled else { return }
            scheduleReconnect()
        }
    }

    private func scheduleReconnect() {
        guard currentURL != nil else { return }
        disconnectHandler?()
        reconnectAttempt += 1
        let delay = min(
            Self.minBackoff * pow(2, Double(reconnectAttempt - 1)),
            Self.maxBackoff
        )
        status = .reconnecting(attempt: reconnectAttempt)

        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.startReceiveLoop()
        }
    }
}
