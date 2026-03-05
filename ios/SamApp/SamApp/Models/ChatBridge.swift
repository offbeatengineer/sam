import Foundation
import UIKit

/// Bridges Sam's internal models to a flat list suitable for the Chat UI.
/// Each item represents one renderable cell in the chat view.
struct ChatMessageItem: Identifiable {
    let id: String
    let isUser: Bool
    let timestamp: Date
    let content: RichContent

    enum RichContent {
        case text(String)
        case markdown(String)
        case thinking(String, done: Bool)
        case toolExecution(StreamingToolExecution)
        case artifactCard(toolCallId: String, toolName: String, title: String, artifactPath: String?)
        case webSearchResults(WebSearchDetails)
        case webFetchPage(WebFetchDetails)
        case systemEvent(String)
        case imageAttachment(UIImage, caption: String?)
        case remoteImageAttachment(remotePath: String, caption: String?)
        case audioAttachment(caption: String?, localURL: URL?)
        case remoteAudioAttachment(remotePath: String)
        case streamingIndicator
    }
}

// MARK: - ToolResult lookup (mirrors desktop toolResultsMap)

/// Extracted tool result info for merging into ToolCards.
struct ToolResultInfo {
    let toolCallId: String
    let toolName: String
    let content: String
    let isError: Bool
    let details: AnyCodable?
}

// MARK: - Web tool detail structs

struct WebSearchResultItem {
    let title: String
    let url: String
    let description: String
    let favicon: String?
    let thumbnail: String?
    let age: String?
    let siteName: String?
}

struct WebSearchDetails {
    let query: String
    let provider: String
    let results: [WebSearchResultItem]
}

struct WebFetchDetails {
    let url: String
    let title: String
    let description: String?
    let siteName: String?
    let image: String?
    let favicon: String?
    let contentLength: Int
    let truncated: Bool
}

// MARK: - Building chat items from session entries

extension ChatMessageItem {
    /// Convert historical session entries into flat chat items.
    static func fromEntries(_ entries: [SessionEntry]) -> [ChatMessageItem] {
        // 1. Build toolResults map from all toolResult entries (keyed by toolCallId)
        var toolResultsMap: [String: ToolResultInfo] = [:]
        for entry in entries {
            if case .toolResult(let toolCallId, let toolName, let content, let isError, let details) = entry.message {
                toolResultsMap[toolCallId] = ToolResultInfo(
                    toolCallId: toolCallId, toolName: toolName,
                    content: content, isError: isError, details: details
                )
            }
        }

        // 2. Render entries
        var items: [ChatMessageItem] = []

        for entry in entries {
            guard let message = entry.message else {
                // Non-message entries (model_change, compaction, etc.)
                if let summary = entry.summary {
                    items.append(ChatMessageItem(
                        id: entry.id,
                        isUser: false,
                        timestamp: parseTimestamp(entry.timestamp),
                        content: .systemEvent(summary)
                    ))
                } else if let modelId = entry.modelId {
                    items.append(ChatMessageItem(
                        id: entry.id,
                        isUser: false,
                        timestamp: parseTimestamp(entry.timestamp),
                        content: .systemEvent("Model: \(modelId)")
                    ))
                }
                continue
            }

            let ts = parseTimestamp(entry.timestamp)

            switch message {
            case .user(let content, let images, let audioAttachments):
                let hasAttachments = !images.isEmpty || !audioAttachments.isEmpty
                // Add text item (skip if empty and there are attachments to show)
                if !content.isEmpty || !hasAttachments {
                    items.append(ChatMessageItem(
                        id: entry.id,
                        isUser: true,
                        timestamp: ts,
                        content: .text(content)
                    ))
                }
                // Add image items from stored data or remote URL
                for (imgIdx, img) in images.enumerated() {
                    if let data = img.data, let uiImage = UIImage(data: data) {
                        items.append(ChatMessageItem(
                            id: "\(entry.id)-img-\(imgIdx)",
                            isUser: true,
                            timestamp: ts,
                            content: .imageAttachment(uiImage, caption: nil)
                        ))
                    } else if let remotePath = img.remotePath {
                        items.append(ChatMessageItem(
                            id: "\(entry.id)-img-\(imgIdx)",
                            isUser: true,
                            timestamp: ts,
                            content: .remoteImageAttachment(remotePath: remotePath, caption: nil)
                        ))
                    }
                }
                // Add audio items from remote URL
                for (audioIdx, audio) in audioAttachments.enumerated() {
                    items.append(ChatMessageItem(
                        id: "\(entry.id)-audio-\(audioIdx)",
                        isUser: true,
                        timestamp: ts,
                        content: .remoteAudioAttachment(remotePath: audio.remotePath)
                    ))
                }

            case .assistant(let blocks, _, _, _):
                for block in blocks {
                    switch block {
                    case .text(let text):
                        items.append(ChatMessageItem(
                            id: "\(entry.id)-\(block.id)",
                            isUser: false,
                            timestamp: ts,
                            content: .markdown(text)
                        ))

                    case .thinking(let text):
                        items.append(ChatMessageItem(
                            id: "\(entry.id)-\(block.id)",
                            isUser: false,
                            timestamp: ts,
                            content: .thinking(text, done: true)
                        ))

                    case .toolCall(let toolId, let name, let arguments):
                        let result = toolResultsMap[toolId]

                        // report_artifact → artifact card
                        if name == "report_artifact", let details = result?.details {
                            let title = (details.value as? [String: Any])?["title"] as? String
                                ?? (arguments.value as? [String: Any])?["title"] as? String
                                ?? "Artifact"
                            let path = (details.value as? [String: Any])?["path"] as? String
                                ?? (arguments.value as? [String: Any])?["path"] as? String
                            items.append(ChatMessageItem(
                                id: "\(entry.id)-\(block.id)",
                                isUser: false,
                                timestamp: ts,
                                content: .artifactCard(toolCallId: toolId, toolName: name, title: title, artifactPath: path)
                            ))
                        } else if name == "web_search", let details = result?.details,
                                  let parsed = Self.parseWebSearchDetails(details) {
                            items.append(ChatMessageItem(
                                id: "\(entry.id)-\(block.id)",
                                isUser: false,
                                timestamp: ts,
                                content: .webSearchResults(parsed)
                            ))
                        } else if name == "web_fetch", let details = result?.details,
                                  let parsed = Self.parseWebFetchDetails(details) {
                            items.append(ChatMessageItem(
                                id: "\(entry.id)-\(block.id)",
                                isUser: false,
                                timestamp: ts,
                                content: .webFetchPage(parsed)
                            ))
                        } else {
                            // Truncate long results for historical display
                            let resultText = result?.content ?? ""
                            let truncatedResult = resultText.count > 1000
                                ? String(resultText.prefix(1000)) + "..."
                                : resultText

                            items.append(ChatMessageItem(
                                id: "\(entry.id)-\(block.id)",
                                isUser: false,
                                timestamp: ts,
                                content: .toolExecution(StreamingToolExecution(
                                    toolCallId: toolId,
                                    toolName: name,
                                    args: arguments,
                                    result: truncatedResult,
                                    isError: result?.isError ?? false,
                                    isDone: true
                                ))
                            ))
                        }
                    }
                }

            case .toolResult:
                // Rendered inline with the preceding assistant message's toolCall
                break

            case .bashExecution(let command, let output, let exitCode):
                // Render bash executions as tool cards too
                let isError = exitCode != nil && exitCode != 0
                items.append(ChatMessageItem(
                    id: entry.id,
                    isUser: false,
                    timestamp: ts,
                    content: .toolExecution(StreamingToolExecution(
                        toolCallId: entry.id,
                        toolName: "bash",
                        args: AnyCodable(["command": command]),
                        result: output,
                        isError: isError,
                        isDone: true
                    ))
                ))

            case .compactionSummary(let summary):
                items.append(ChatMessageItem(
                    id: entry.id,
                    isUser: false,
                    timestamp: ts,
                    content: .systemEvent(summary)
                ))

            case .other:
                break
            }
        }

        return items
    }

    /// Append streaming turn content to the items list, preserving stream order.
    static func fromStreamingTurn(_ turn: StreamingTurn) -> [ChatMessageItem] {
        let now = Date()
        var result: [ChatMessageItem] = []

        for (i, item) in turn.items.enumerated() {
            switch item {
            case .text(let text) where !text.isEmpty:
                result.append(ChatMessageItem(
                    id: "streaming-text-\(i)",
                    isUser: false,
                    timestamp: now,
                    content: .markdown(text)
                ))
            case .thinking(let text, let done) where !text.isEmpty:
                result.append(ChatMessageItem(
                    id: "streaming-thinking-\(i)",
                    isUser: false,
                    timestamp: now,
                    content: .thinking(text, done: done)
                ))
            case .tool(let tool):
                if tool.toolName == "report_artifact" {
                    let argsDict = tool.args.value as? [String: Any]
                    let title = argsDict?["title"] as? String ?? "Artifact"
                    let path = argsDict?["path"] as? String
                    result.append(ChatMessageItem(
                        id: "streaming-tool-\(tool.toolCallId)",
                        isUser: false,
                        timestamp: now,
                        content: .artifactCard(toolCallId: tool.toolCallId, toolName: tool.toolName, title: title, artifactPath: path)
                    ))
                } else if tool.toolName == "web_search" && tool.isDone,
                          let details = tool.details,
                          let parsed = parseWebSearchDetails(details) {
                    result.append(ChatMessageItem(
                        id: "streaming-tool-\(tool.toolCallId)",
                        isUser: false,
                        timestamp: now,
                        content: .webSearchResults(parsed)
                    ))
                } else if tool.toolName == "web_fetch" && tool.isDone,
                          let details = tool.details,
                          let parsed = parseWebFetchDetails(details) {
                    result.append(ChatMessageItem(
                        id: "streaming-tool-\(tool.toolCallId)",
                        isUser: false,
                        timestamp: now,
                        content: .webFetchPage(parsed)
                    ))
                } else {
                    result.append(ChatMessageItem(
                        id: "streaming-tool-\(tool.toolCallId)",
                        isUser: false,
                        timestamp: now,
                        content: .toolExecution(tool)
                    ))
                }
            default:
                break
            }
        }

        return result
    }

    // MARK: - Web tool detail parsing

    private static func parseWebSearchDetails(_ details: AnyCodable) -> WebSearchDetails? {
        guard let dict = details.value as? [String: Any],
              let query = dict["query"] as? String,
              let provider = dict["provider"] as? String,
              let rawResults = dict["results"] as? [[String: Any]] else { return nil }

        let results = rawResults.map { r in
            WebSearchResultItem(
                title: r["title"] as? String ?? "",
                url: r["url"] as? String ?? "",
                description: r["description"] as? String ?? "",
                favicon: r["favicon"] as? String,
                thumbnail: r["thumbnail"] as? String,
                age: r["age"] as? String,
                siteName: r["siteName"] as? String
            )
        }
        return WebSearchDetails(query: query, provider: provider, results: results)
    }

    private static func parseWebFetchDetails(_ details: AnyCodable) -> WebFetchDetails? {
        guard let dict = details.value as? [String: Any],
              let url = dict["url"] as? String,
              let title = dict["title"] as? String else { return nil }

        return WebFetchDetails(
            url: url,
            title: title,
            description: dict["description"] as? String,
            siteName: dict["siteName"] as? String,
            image: dict["image"] as? String,
            favicon: dict["favicon"] as? String,
            contentLength: dict["contentLength"] as? Int ?? 0,
            truncated: dict["truncated"] as? Bool ?? false
        )
    }

    // MARK: - Helpers

    private static func parseTimestamp(_ ts: String?) -> Date {
        guard let ts else { return Date() }
        return ISO8601DateFormatter().date(from: ts) ?? Date()
    }
}

