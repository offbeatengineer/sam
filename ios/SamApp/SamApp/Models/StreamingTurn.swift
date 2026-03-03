import Foundation

/// A single item in the streaming timeline, preserving arrival order.
enum StreamItem {
    case text(String)
    case thinking(String, done: Bool)
    case tool(StreamingToolExecution)
}

/// Tracks the state of a streaming assistant turn in progress.
@Observable
final class StreamingTurn {
    var conversationId: String
    var requestId: String
    var isActive: Bool = true

    /// Single ordered timeline — items appended as they arrive from the stream.
    var items: [StreamItem] = []

    init(conversationId: String, requestId: String) {
        self.conversationId = conversationId
        self.requestId = requestId
    }

    // MARK: - Text

    func appendTextDelta(_ delta: String) {
        if case .text(var current) = items.last {
            current += delta
            items[items.count - 1] = .text(current)
        } else {
            items.append(.text(delta))
        }
    }

    // MARK: - Thinking

    func appendThinkingDelta(_ delta: String) {
        if case .thinking(var current, let done) = items.last {
            current += delta
            items[items.count - 1] = .thinking(current, done: done)
        } else {
            items.append(.thinking(delta, done: false))
        }
    }

    func completeThinking() {
        if case .thinking(let text, _) = items.last {
            items[items.count - 1] = .thinking(text, done: true)
        }
    }

    // MARK: - Tools

    func addToolStart(toolCallId: String, toolName: String, args: AnyCodable) {
        items.append(.tool(StreamingToolExecution(
            toolCallId: toolCallId,
            toolName: toolName,
            args: args
        )))
    }

    func updateTool(toolCallId: String, partialResult: String) {
        guard let idx = toolIndex(for: toolCallId) else { return }
        if case .tool(var tool) = items[idx] {
            tool.partialResult += partialResult
            items[idx] = .tool(tool)
        }
    }

    func endTool(toolCallId: String, result: String, isError: Bool, details: AnyCodable?) {
        guard let idx = toolIndex(for: toolCallId) else { return }
        if case .tool(var tool) = items[idx] {
            tool.result = result
            tool.isError = isError
            tool.details = details
            tool.isDone = true
            items[idx] = .tool(tool)
        }
    }

    // MARK: - Convenience

    var toolExecutions: [StreamingToolExecution] {
        items.compactMap {
            if case .tool(let t) = $0 { return t }
            return nil
        }
    }

    // MARK: - Helpers

    private func toolIndex(for toolCallId: String) -> Int? {
        items.firstIndex {
            if case .tool(let t) = $0 { return t.toolCallId == toolCallId }
            return false
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
