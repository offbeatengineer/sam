import Foundation

/// Root view model. Owns the connection and routes messages to sub-VMs.
@MainActor @Observable
final class AppViewModel {
    let connectionManager = ConnectionManager()
    let correlator = RequestCorrelator()
    let sessionListVM = SessionListViewModel()
    let chatVM = ChatViewModel()
    let memoryVM = MemoryViewModel()
    let skillVM = SkillViewModel()
    let artifactVM = ArtifactViewModel()
    let kitVM = KitViewModel()
    let settingsVM = SettingsViewModel()

    /// Tracks which conversations are currently streaming (for sidebar indicators).
    var streamingConversations: Set<String> = []

    var hasConfiguredConnection: Bool {
        settingsVM.serverURL != nil
    }

    func connect() {
        guard let url = settingsVM.serverURL else { return }
        // Avoid duplicate connect calls (onAppear + onChange(.active) can both fire)
        switch connectionManager.status {
        case .disconnected, .error: break
        default: return
        }
        if let artifactsURL = settingsVM.artifactsURL {
            artifactVM.artifactsBaseURL = artifactsURL
            kitVM.baseURL = artifactsURL
        }
        print("[App] Connecting to \(url)...")
        Task {
            await connectionManager.connect(url: url, apiKey: settingsVM.apiKey) { [weak self] in
                print("[App] Connected, reloading sessions...")
                guard let self else { return }
                Task { await self.sessionListVM.loadSessions(using: self) }
            } onDisconnect: { [weak self] in
                guard let self else { return }
                for convId in streamingConversations {
                    chatVM.endStreaming(conversationId: convId)
                }
                streamingConversations.removeAll()
            } onMessage: { [weak self] message in
                self?.routeMessage(message)
            }
        }
    }

    func disconnect() {
        Task {
            await connectionManager.disconnect()
            await correlator.cancelAll()
        }
    }

    /// Switch to a different backend instance.
    func switchInstance(to id: UUID) {
        guard id != settingsVM.activeInstanceId else { return }
        let name = settingsVM.instances.first { $0.id == id }?.name ?? "unknown"
        print("[App] Switching to instance '\(name)'")
        // Clear stale data
        chatVM.clearAll()
        sessionListVM.clearAll()
        streamingConversations.removeAll()
        settingsVM.setActive(id)
        Task {
            await correlator.cancelAll()
            // connect() awaits tearDown() of old connection before starting new one
            guard let url = settingsVM.serverURL else { return }
            if let artifactsURL = settingsVM.artifactsURL {
                artifactVM.artifactsBaseURL = artifactsURL
            kitVM.baseURL = artifactsURL
            }
            print("[App] Connecting to \(url)...")
            await connectionManager.connect(url: url, apiKey: settingsVM.apiKey) { [weak self] in
                print("[App] Connected, reloading sessions...")
                guard let self else { return }
                Task { await self.sessionListVM.loadSessions(using: self) }
            } onDisconnect: { [weak self] in
                guard let self else { return }
                for convId in streamingConversations {
                    chatVM.endStreaming(conversationId: convId)
                }
                streamingConversations.removeAll()
            } onMessage: { [weak self] message in
                self?.routeMessage(message)
            }
        }
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
            self.handleStreamingMessage(message)
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
        case .textDelta(let convId, let delta, _):
            if chatVM.activeConversationId == convId {
                chatVM.appendTextDelta(delta)
            }

        // Thinking streaming
        case .thinkingDelta(let convId, let delta, _):
            if chatVM.activeConversationId == convId {
                chatVM.appendThinkingDelta(delta)
            }

        case .thinkingEnd(let convId, _):
            if chatVM.activeConversationId == convId {
                chatVM.completeThinking()
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

        // Kits
        case .kitsChanged:
            Task { await kitVM.loadKits() }

        // Request-response messages that weren't correlated (shouldn't happen normally)
        default:
            break
        }
    }
}
