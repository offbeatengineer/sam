import Foundation

/// Tracks the state of a streaming assistant turn in progress.
@Observable
final class StreamingTurn {
    var conversationId: String
    var requestId: String
    var isActive: Bool = true
    var contentBlocks: [ContentStreamBlock] = []
    var toolExecutions: [StreamingToolExecution] = []

    init(conversationId: String, requestId: String) {
        self.conversationId = conversationId
        self.requestId = requestId
    }

    // MARK: - Text

    func appendTextDelta(_ delta: String, contentIndex: Int) {
        ensureTextBlock(at: contentIndex)
        if case .text(var current) = contentBlocks[contentIndex] {
            current += delta
            contentBlocks[contentIndex] = .text(current)
        }
    }

    // MARK: - Thinking

    func appendThinkingDelta(_ delta: String, contentIndex: Int) {
        ensureThinkingBlock(at: contentIndex)
        if case .thinking(var current, let done) = contentBlocks[contentIndex] {
            current += delta
            contentBlocks[contentIndex] = .thinking(current, done: done)
        }
    }

    func completeThinking(contentIndex: Int) {
        guard contentIndex < contentBlocks.count,
              case .thinking(let text, _) = contentBlocks[contentIndex] else { return }
        contentBlocks[contentIndex] = .thinking(text, done: true)
    }

    // MARK: - Tools

    func addToolStart(toolCallId: String, toolName: String, args: AnyCodable) {
        toolExecutions.append(StreamingToolExecution(
            toolCallId: toolCallId,
            toolName: toolName,
            args: args
        ))
    }

    func updateTool(toolCallId: String, partialResult: String) {
        guard let idx = toolExecutions.firstIndex(where: { $0.toolCallId == toolCallId }) else { return }
        toolExecutions[idx].partialResult += partialResult
    }

    func endTool(toolCallId: String, result: String, isError: Bool, details: AnyCodable?) {
        guard let idx = toolExecutions.firstIndex(where: { $0.toolCallId == toolCallId }) else { return }
        toolExecutions[idx].result = result
        toolExecutions[idx].isError = isError
        toolExecutions[idx].details = details
        toolExecutions[idx].isDone = true
    }

    // MARK: - Helpers

    private func ensureTextBlock(at index: Int) {
        while contentBlocks.count <= index {
            contentBlocks.append(.text(""))
        }
        if case .text = contentBlocks[index] { return }
        // Index exists but isn't text — shouldn't happen in normal flow, but handle gracefully
    }

    private func ensureThinkingBlock(at index: Int) {
        while contentBlocks.count <= index {
            contentBlocks.append(.thinking("", done: false))
        }
        if case .thinking = contentBlocks[index] { return }
    }
}

// MARK: - Content blocks during streaming

enum ContentStreamBlock: Identifiable {
    case text(String)
    case thinking(String, done: Bool)

    var id: String {
        switch self {
        case .text(let s): return "stream-text-\(s.hashValue)"
        case .thinking(let s, _): return "stream-thinking-\(s.hashValue)"
        }
    }
}

// MARK: - Tool execution during streaming

struct StreamingToolExecution: Identifiable {
    let toolCallId: String
    let toolName: String
    let args: AnyCodable
    var partialResult: String = ""
    var result: String = ""
    var isError: Bool = false
    var details: AnyCodable?
    var isDone: Bool = false

    var id: String { toolCallId }
}
