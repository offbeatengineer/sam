import SwiftUI
import UIKit
import ExyteChat

struct ChatContainerView: View {
    @Environment(AppViewModel.self) private var appVM
    let session: SessionInfo?

    private var isNewChat: Bool { session == nil }
    private var isReadOnly: Bool { session?.isReadOnly ?? false }

    /// Lookup dictionary for our custom cells, keyed by item ID.
    private var chatItemsByID: [String: ChatMessageItem] {
        Dictionary(appVM.chatVM.chatItems.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    }

    /// Convert our chat items to ExyteChat Messages.
    private var exyteMessages: [ExyteChat.Message] {
        appVM.chatVM.chatItems.map { $0.toExyteMessage() }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            if isReadOnly {
                readOnlyView
            } else {
                chatView
            }

            // Abort button overlay during streaming
            if appVM.chatVM.isStreaming {
                abortButton
            }
        }
        .navigationTitle(session?.displayName ?? "New Chat")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let session {
                await appVM.chatVM.selectSession(session, using: appVM)
            }
        }
    }

    // MARK: - ExyteChat ChatView

    private var chatView: some View {
        ChatView(messages: exyteMessages) { draft in
            Task { await appVM.chatVM.sendMessage(draft: draft, using: appVM) }
        } messageBuilder: { message, _, _, _, _, _, _ in
            if let item = chatItemsByID[message.id] {
                AnyView(
                    chatCell(for: item)
                        .padding(.vertical, 8)
                )
            } else {
                AnyView(EmptyView())
            }
        }
        .setAvailableInputs([.text, .media, .audio])
        .setRecorderSettings(RecorderSettings(
            sampleRate: 44100,
            encoderBitRateKey: 128000
        ))
        .showMessageMenuOnLongPress(false)
        .showDateHeaders(false)
        .showMessageTimeView(false)
    }

    // MARK: - Read-only fallback (no input bar)

    private var readOnlyView: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(appVM.chatVM.chatItems) { item in
                        chatCell(for: item)
                    }
                }
                .padding()
            }
            readOnlyBanner
        }
    }

    // MARK: - Cell dispatcher

    @ViewBuilder
    private func chatCell(for item: ChatMessageItem) -> some View {
        switch item.content {
        case .text(let text):
            userBubble(text)

        case .markdown(let text):
            MarkdownMessageCell(text: text)

        case .thinking(let text, let done):
            ThinkingCell(text: text, isDone: done)

        case .toolExecution(let tool):
            ToolCardCell(tool: tool)

        case .artifactCard(_, _, let title):
            ArtifactCardCell(title: title)

        case .systemEvent(let text):
            SystemEventCell(text: text)

        case .imageAttachment(let image, let caption):
            imageBubble(image, caption: caption)

        case .remoteImageAttachment(let remotePath, let caption):
            remoteImageBubble(remotePath: remotePath, caption: caption)

        case .audioAttachment(let caption):
            audioBubble(caption: caption)

        case .remoteAudioAttachment:
            audioBubble(caption: nil)
        }
    }

    // MARK: - User bubble

    private func userBubble(_ text: String) -> some View {
        HStack {
            Spacer()
            Text(text)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.blue)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }

    // MARK: - Image bubble

    private func imageBubble(_ image: UIImage, caption: String?) -> some View {
        HStack {
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(maxWidth: 220, maxHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                if let caption, !caption.isEmpty {
                    Text(caption)
                        .font(.subheadline)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.blue)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
            }
        }
    }

    // MARK: - Remote image bubble

    private func remoteImageBubble(remotePath: String, caption: String?) -> some View {
        let fullURL: URL? = {
            guard let base = appVM.settingsVM.artifactsURL,
                  var components = URLComponents(string: remotePath) else { return nil }
            components.scheme = base.scheme
            components.host = base.host
            components.port = base.port
            if let apiKey = appVM.settingsVM.apiKey, !apiKey.isEmpty {
                let existing = components.queryItems ?? []
                components.queryItems = existing + [URLQueryItem(name: "apiKey", value: apiKey)]
            }
            return components.url
        }()
        return HStack {
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                if let fullURL {
                    AsyncImage(url: fullURL) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(maxWidth: 220, maxHeight: 220)
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                        case .failure:
                            imagePlaceholder(systemName: "exclamationmark.triangle")
                        default:
                            imagePlaceholder(systemName: "photo")
                        }
                    }
                } else {
                    imagePlaceholder(systemName: "photo")
                }

                if let caption, !caption.isEmpty {
                    Text(caption)
                        .font(.subheadline)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.blue)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
            }
        }
    }

    private func imagePlaceholder(systemName: String) -> some View {
        Image(systemName: systemName)
            .font(.largeTitle)
            .foregroundStyle(.secondary)
            .frame(width: 120, height: 120)
            .background(Color.gray.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Audio bubble

    private func audioBubble(caption: String?) -> some View {
        HStack {
            Spacer()
            HStack(spacing: 8) {
                Image(systemName: "waveform")
                    .font(.title3)
                Text(caption ?? "Audio message")
                    .font(.subheadline)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.blue)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }

    // MARK: - Abort button

    private var abortButton: some View {
        Button {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            Task { await appVM.chatVM.abort(using: appVM) }
        } label: {
            Label("Stop", systemImage: "stop.circle.fill")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(.red, in: Capsule())
        }
        .padding(.bottom, 80) // above the input bar
    }

    // MARK: - Read-only banner

    private var readOnlyBanner: some View {
        HStack {
            Image(systemName: "eye")
            Text("Read-only session (\(session?.channelId ?? ""))")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(.bar)
    }
}
