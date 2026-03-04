import Foundation
import ExyteChat
import ExyteMediaPicker
import UIKit

@MainActor @Observable
final class ChatViewModel {
    var activeConversationId: String?
    var inputText: String = ""
    var isStreaming: Bool = false
    var streamingTurn: StreamingTurn?

    /// Historical entries loaded from server.
    private(set) var historicalEntries: [SessionEntry] = []

    /// Local attachment items keyed by the associated user entry ID, inserted inline after that entry.
    private var localAttachmentsByEntryId: [String: [ChatMessageItem]] = [:]

    /// Computed chat items: historical (with inline local attachments) + live streaming.
    var chatItems: [ChatMessageItem] {
        var items = ChatMessageItem.fromEntries(historicalEntries)

        // Insert local attachment items inline with their associated user entry
        if !localAttachmentsByEntryId.isEmpty {
            var ops: [(index: Int, attachItems: [ChatMessageItem], replaceAnchor: Bool)] = []
            for (entryId, attachItems) in localAttachmentsByEntryId {
                if let idx = items.firstIndex(where: { $0.id == entryId }) {
                    // If the anchor is an empty text bubble, replace it with attachments
                    let isEmptyText: Bool
                    if case .text(let t) = items[idx].content, t.isEmpty { isEmptyText = true }
                    else { isEmptyText = false }
                    ops.append((idx, attachItems, isEmptyText))
                }
            }
            for op in ops.sorted(by: { $0.index > $1.index }) {
                if op.replaceAnchor {
                    items.remove(at: op.index)
                    items.insert(contentsOf: op.attachItems, at: op.index)
                } else {
                    items.insert(contentsOf: op.attachItems, at: op.index + 1)
                }
            }
        }

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
        localAttachmentsByEntryId = [:]
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
            message: .user(content: text, images: [], audioAttachments: []),
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

    /// Send a message from an ExyteChat DraftMessage (may include media/audio attachments).
    func sendMessage(draft: DraftMessage, using app: AppViewModel) async {
        guard let convId = activeConversationId else { return }
        let text = draft.text.trimmingCharacters(in: .whitespacesAndNewlines)

        let hasMedia = !draft.medias.isEmpty
        let hasAudio = draft.recording != nil
        let hasAttachments = hasMedia || hasAudio

        // Nothing to send
        guard !text.isEmpty || hasAttachments else { return }

        // Build upload base URL from settings
        if hasAttachments {
            guard app.settingsVM.artifactsURL != nil else {
                print("[Chat] No server URL configured for uploads")
                return
            }
        }
        let baseURL = app.settingsVM.artifactsURL
        let apiKey = app.settingsVM.apiKey

        let requestId = UUID().uuidString

        // Always create a user entry so attachments can anchor to it.
        let entryId = UUID().uuidString
        let userEntry = SessionEntry(
            id: entryId,
            entryType: "message",
            message: .user(content: text, images: [], audioAttachments: []),
            timestamp: ISO8601DateFormatter().string(from: Date()),
            modelId: nil, summary: nil
        )
        historicalEntries.append(userEntry)

        // Collect resized images for display and upload
        var imageItems: [(UIImage, Data)] = []
        for media in draft.medias {
            if let data = await resizedImageData(from: media),
               let image = UIImage(data: data) {
                imageItems.append((image, data))
            }
        }

        // Build local attachment items keyed to the user entry
        var attachItemsForEntry: [ChatMessageItem] = []
        for (image, _) in imageItems {
            attachItemsForEntry.append(ChatMessageItem(
                id: UUID().uuidString,
                isUser: true,
                timestamp: Date(),
                content: .imageAttachment(image, caption: nil)
            ))
        }
        if hasAudio {
            let duration = draft.recording?.duration ?? 0
            let durationText = duration > 0
                ? String(format: "%d:%02d", Int(duration) / 60, Int(duration) % 60)
                : nil
            attachItemsForEntry.append(ChatMessageItem(
                id: UUID().uuidString,
                isUser: true,
                timestamp: Date(),
                content: .audioAttachment(caption: durationText)
            ))
        }
        if !attachItemsForEntry.isEmpty {
            localAttachmentsByEntryId[entryId] = attachItemsForEntry
        }

        // Upload attachments
        var attachments: [ChatAttachment] = []

        if let baseURL {
            for (_, data) in imageItems {
                do {
                    let response = try await UploadClient.upload(
                        data: data, mimeType: "image/jpeg", baseURL: baseURL, apiKey: apiKey
                    )
                    attachments.append(ChatAttachment(type: "image", path: response.path, mimeType: response.mimeType))
                } catch {
                    print("[Chat] Image upload failed: \(error)")
                }
            }

            if let recording = draft.recording, let url = recording.url {
                do {
                    let data = try Data(contentsOf: url)
                    let ext = url.pathExtension.lowercased()
                    let mimeType = ext == "wav" ? "audio/wav" : "audio/aac"
                    let response = try await UploadClient.upload(
                        data: data, mimeType: mimeType, baseURL: baseURL, apiKey: apiKey
                    )
                    attachments.append(ChatAttachment(type: "audio", path: response.path, mimeType: response.mimeType))
                } catch {
                    print("[Chat] Audio upload failed: \(error)")
                }
            }
        }

        do {
            try await app.send(.chat(
                requestId: requestId,
                conversationId: convId,
                text: text,
                attachments: attachments.isEmpty ? nil : attachments
            ))
        } catch {
            print("[Chat] Failed to send message: \(error)")
        }
    }

    /// Resize an ExyteMediaPicker Media to max 1024px and JPEG compress.
    private func resizedImageData(from media: ExyteMediaPicker.Media) async -> Data? {
        guard let data = await media.getData() else { return nil }
        guard let image = UIImage(data: data) else { return data }

        let maxDimension: CGFloat = 1024
        let size = image.size
        if size.width <= maxDimension && size.height <= maxDimension {
            return image.jpegData(compressionQuality: 0.85)
        }

        let scale = min(maxDimension / size.width, maxDimension / size.height)
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        let resized = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
        return resized.jpegData(compressionQuality: 0.85)
    }

    /// Prepare state for a brand-new chat (no message sent yet).
    func prepareNewSession() {
        activeConversationId = UUID().uuidString
        historicalEntries = []
        localAttachmentsByEntryId = [:]
        streamingTurn = nil
        isStreaming = false
        inputText = ""
    }

    func clearAll() {
        activeConversationId = nil
        historicalEntries = []
        localAttachmentsByEntryId = [:]
        streamingTurn = nil
        isStreaming = false
        inputText = ""
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
