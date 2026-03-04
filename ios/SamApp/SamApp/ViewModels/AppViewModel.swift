import Foundation

/// Root view model. Owns the connection and routes messages to sub-VMs.
@Observable
final class AppViewModel {
    let connectionManager = ConnectionManager()
    let correlator = RequestCorrelator()
    let sessionListVM = SessionListViewModel()
    let chatVM = ChatViewModel()
    let memoryVM = MemoryViewModel()
    let skillVM = SkillViewModel()
    let artifactVM = ArtifactViewModel()
    let settingsVM = SettingsViewModel()

    /// Tracks which conversations are currently streaming (for sidebar indicators).
    var streamingConversations: Set<String> = []

    var hasConfiguredConnection: Bool {
        settingsVM.serverURL != nil
    }

    func connect() {
        guard let url = settingsVM.serverURL else { return }
        // Sync artifacts base URL on connect
        if let artifactsURL = settingsVM.artifactsURL {
            artifactVM.artifactsBaseURL = artifactsURL
        }
        connectionManager.connect(url: url, apiKey: settingsVM.apiKey) { [weak self] message in
            self?.routeMessage(message)
        }
    }

    func disconnect() {
        connectionManager.disconnect()
        Task { await correlator.cancelAll() }
    }

    /// Switch to a different backend instance: disconnect, set active, reconnect.
    func switchInstance(to id: UUID) {
        guard id != settingsVM.activeInstanceId else { return }
        disconnect()
        settingsVM.setActive(id)
        // Clear stale data from previous instance
        chatVM.clearAll()
        sessionListVM.clearAll()
        streamingConversations.removeAll()
        connect()
        // SessionListView observes connectionManager.status and reloads on .connected
    }

    /// Send a request and wait for a correlated response.
    func request(_ clientRequest: ClientRequest, requestId: String) async throws -> ServerMessage {
        async let response = correlator.waitForResponse(requestId: requestId)
        try await connectionManager.send(clientRequest)
        return try await response
    }

    /// Send a fire-and-forget request (e.g., chat, abort).
    func send(_ clientRequest: ClientRequest) async throws {
        try await connectionManager.send(clientRequest)
    }

    // MARK: - Message routing

    private func routeMessage(_ message: ServerMessage) {
        // Try request-response correlation first
        Task {
            let consumed = await correlator.deliver(message)
            if consumed { return }
            await MainActor.run { self.handleStreamingMessage(message) }
        }
    }

    private func handleStreamingMessage(_ message: ServerMessage) {
        switch message {
        // Turn lifecycle
        case .turnStart(let convId, let reqId):
            streamingConversations.insert(convId)
            chatVM.beginStreaming(conversationId: convId, requestId: reqId)

        case .turnEnd(let convId, _):
            streamingConversations.remove(convId)
            chatVM.endStreaming(conversationId: convId)
            // Refresh session list after a turn completes
            Task { await sessionListVM.loadSessions(using: self) }

        // Text streaming
        case .textDelta(let convId, let delta, let contentIndex):
            if chatVM.activeConversationId == convId {
                chatVM.appendTextDelta(delta, contentIndex: contentIndex)
            }

        // Thinking streaming
        case .thinkingDelta(let convId, let delta, let contentIndex):
            if chatVM.activeConversationId == convId {
                chatVM.appendThinkingDelta(delta, contentIndex: contentIndex)
            }

        case .thinkingEnd(let convId, let contentIndex):
            if chatVM.activeConversationId == convId {
                chatVM.completeThinking(contentIndex: contentIndex)
            }

        // Tool execution
        case .toolStart(let convId, let toolCallId, let toolName, let args):
            if chatVM.activeConversationId == convId {
                chatVM.addToolStart(toolCallId: toolCallId, toolName: toolName, args: args)
            }

        case .toolUpdate(let convId, let toolCallId, let toolName, let partialResult):
            if chatVM.activeConversationId == convId {
                chatVM.updateTool(toolCallId: toolCallId, partialResult: partialResult)
            }
            _ = toolName // suppress unused warning

        case .toolEnd(let convId, let toolCallId, let toolName, let result, let isError, let details):
            if chatVM.activeConversationId == convId {
                chatVM.endTool(toolCallId: toolCallId, result: result, isError: isError, details: details)
            }
            _ = toolName

        // Session lifecycle
        case .sessionCreated:
            break

        case .sessionClosed:
            break

        case .aborted(let convId):
            streamingConversations.remove(convId)
            if chatVM.activeConversationId == convId {
                chatVM.endStreaming(conversationId: convId)
            }

        case .error(_, let error):
            print("[App] Server error: \(error)")

        // Artifacts
        case .artifactsChanged:
            Task { await artifactVM.loadArtifacts(using: self) }

        // Request-response messages that weren't correlated (shouldn't happen normally)
        default:
            break
        }
    }
}
