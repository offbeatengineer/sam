import Foundation

@Observable
final class ChatViewModel {
    var activeConversationId: String?
    var inputText: String = ""
    var isStreaming: Bool = false
    var streamingTurn: StreamingTurn?

    /// Historical entries loaded from server.
    private(set) var historicalEntries: [SessionEntry] = []

    /// Computed chat items: historical + live streaming merged.
    var chatItems: [ChatMessageItem] {
        var items = ChatMessageItem.fromEntries(historicalEntries)
        if let turn = streamingTurn, turn.isActive {
            items.append(contentsOf: ChatMessageItem.fromStreamingTurn(turn))
        }
        return items
    }

    // MARK: - Session navigation

    func selectSession(_ session: SessionInfo, using app: AppViewModel) async {
        activeConversationId = session.conversationId
        streamingTurn = nil
        isStreaming = false
        await loadEntries(sessionPath: session.path, using: app)
    }

    func loadEntries(sessionPath: String, using app: AppViewModel) async {
        let requestId = UUID().uuidString
        do {
            let response = try await app.request(
                .getSessionEntries(requestId: requestId, sessionPath: sessionPath),
                requestId: requestId
            )
            if case .sessionEntries(_, _, let entries) = response {
                await MainActor.run {
                    self.historicalEntries = entries.compactMap { SessionEntry.parse(from: $0) }
                }
            }
        } catch {
            print("[Chat] Failed to load entries: \(error)")
        }
    }

    // MARK: - Send message

    func sendMessage(using app: AppViewModel) async {
        guard let convId = activeConversationId else { return }
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let requestId = UUID().uuidString
        inputText = ""

        // Add user message to items immediately
        let userEntry = SessionEntry(
            id: UUID().uuidString,
            entryType: "message",
            message: .user(content: text),
            timestamp: ISO8601DateFormatter().string(from: Date()),
            modelId: nil, summary: nil
        )
        historicalEntries.append(userEntry)

        do {
            try await app.send(.chat(requestId: requestId, conversationId: convId, text: text))
        } catch {
            print("[Chat] Failed to send message: \(error)")
        }
    }

    func sendMessageToNewSession(using app: AppViewModel) async {
        let convId = UUID().uuidString
        activeConversationId = convId
        historicalEntries = []
        streamingTurn = nil
        await sendMessage(using: app)
    }

    // MARK: - Abort

    func abort(using app: AppViewModel) async {
        guard let convId = activeConversationId else { return }
        do {
            try await app.send(.abort(conversationId: convId))
        } catch {
            print("[Chat] Failed to abort: \(error)")
        }
    }

    // MARK: - Streaming mutations

    func beginStreaming(conversationId: String, requestId: String) {
        isStreaming = true
        streamingTurn = StreamingTurn(conversationId: conversationId, requestId: requestId)
    }

    func endStreaming(conversationId: String) {
        guard streamingTurn?.conversationId == conversationId else { return }
        streamingTurn?.isActive = false
        isStreaming = false
        // Merge streaming content into historical entries
        if let turn = streamingTurn {
            mergeStreamingTurn(turn)
        }
        streamingTurn = nil
    }

    func appendTextDelta(_ delta: String, contentIndex: Int) {
        streamingTurn?.appendTextDelta(delta, contentIndex: contentIndex)
    }

    func appendThinkingDelta(_ delta: String, contentIndex: Int) {
        streamingTurn?.appendThinkingDelta(delta, contentIndex: contentIndex)
    }

    func completeThinking(contentIndex: Int) {
        streamingTurn?.completeThinking(contentIndex: contentIndex)
    }

    func addToolStart(toolCallId: String, toolName: String, args: AnyCodable) {
        streamingTurn?.addToolStart(toolCallId: toolCallId, toolName: toolName, args: args)
    }

    func updateTool(toolCallId: String, partialResult: String) {
        streamingTurn?.updateTool(toolCallId: toolCallId, partialResult: partialResult)
    }

    func endTool(toolCallId: String, result: String, isError: Bool, details: AnyCodable?) {
        streamingTurn?.endTool(toolCallId: toolCallId, result: result, isError: isError, details: details)
    }

    // MARK: - Helpers

    private func mergeStreamingTurn(_ turn: StreamingTurn) {
        var blocks: [AssistantContentBlock] = []
        for block in turn.contentBlocks {
            switch block {
            case .text(let text) where !text.isEmpty:
                blocks.append(.text(text))
            case .thinking(let text, _) where !text.isEmpty:
                blocks.append(.thinking(text))
            default:
                break
            }
        }
        for tool in turn.toolExecutions {
            blocks.append(.toolCall(id: tool.toolCallId, name: tool.toolName, arguments: tool.args))
        }
        if !blocks.isEmpty {
            // Add assistant entry
            historicalEntries.append(SessionEntry(
                id: UUID().uuidString,
                entryType: "message",
                message: .assistant(content: blocks),
                timestamp: ISO8601DateFormatter().string(from: Date()),
                modelId: nil, summary: nil
            ))
            // Add tool result entries so the toolResults map can pick them up
            for tool in turn.toolExecutions where tool.isDone {
                historicalEntries.append(SessionEntry(
                    id: UUID().uuidString,
                    entryType: "message",
                    message: .toolResult(
                        toolCallId: tool.toolCallId,
                        toolName: tool.toolName,
                        content: tool.result,
                        isError: tool.isError,
                        details: tool.details
                    ),
                    timestamp: ISO8601DateFormatter().string(from: Date()),
                    modelId: nil, summary: nil
                ))
            }
        }
    }
}
