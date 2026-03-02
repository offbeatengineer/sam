import SwiftUI

struct ChatContainerView: View {
    @Environment(AppViewModel.self) private var appVM
    let session: SessionInfo?

    /// Whether this is the initial load (skip animation for scroll-to-bottom).
    @State private var isInitialLoad = true

    private var isNewChat: Bool { session == nil }
    private var isReadOnly: Bool { session?.isReadOnly ?? false }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(appVM.chatVM.chatItems) { item in
                            chatCell(for: item)
                                .id(item.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: appVM.chatVM.chatItems.count) { _, _ in
                    scrollToBottom(proxy: proxy)
                }
                .onAppear {
                    // Jump to bottom immediately on first appear
                    scrollToBottom(proxy: proxy)
                }
            }

            if isReadOnly {
                readOnlyBanner
            } else {
                inputBar
            }
        }
        .navigationTitle(session?.displayName ?? "New Chat")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let session {
                await appVM.chatVM.selectSession(session, using: appVM)
            }
            // After entries load, mark initial load done
            try? await Task.sleep(for: .milliseconds(100))
            isInitialLoad = false
        }
    }

    // MARK: - Scroll

    private func scrollToBottom(proxy: ScrollViewProxy) {
        guard let lastId = appVM.chatVM.chatItems.last?.id else { return }
        if isInitialLoad {
            proxy.scrollTo(lastId, anchor: .bottom)
        } else {
            withAnimation(.easeOut(duration: 0.15)) {
                proxy.scrollTo(lastId, anchor: .bottom)
            }
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

    // MARK: - Input bar

    private var inputBar: some View {
        HStack(spacing: 8) {
            @Bindable var chatVM = appVM.chatVM

            TextField("Message...", text: $chatVM.inputText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...5)
                .onSubmit {
                    sendMessage()
                }

            if appVM.chatVM.isStreaming {
                Button {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    Task { await appVM.chatVM.abort(using: appVM) }
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.red)
                }
            } else {
                Button {
                    sendMessage()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(appVM.chatVM.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func sendMessage() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        Task { await appVM.chatVM.sendMessage(using: appVM) }
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
