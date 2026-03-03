import SwiftUI

struct ChatContainerView: View {
    @Environment(AppViewModel.self) private var appVM
    let session: SessionInfo

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
                    if let lastId = appVM.chatVM.chatItems.last?.id {
                        withAnimation {
                            proxy.scrollTo(lastId, anchor: .bottom)
                        }
                    }
                }
            }

            if session.isReadOnly {
                readOnlyBanner
            } else {
                inputBar
            }
        }
        .navigationTitle(session.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await appVM.chatVM.selectSession(session, using: appVM)
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

            if appVM.chatVM.isStreaming {
                Button {
                    Task { await appVM.chatVM.abort(using: appVM) }
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.red)
                }
            } else {
                Button {
                    Task { await appVM.chatVM.sendMessage(using: appVM) }
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

    // MARK: - Read-only banner

    private var readOnlyBanner: some View {
        HStack {
            Image(systemName: "eye")
            Text("Read-only session (\(session.channelId))")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(.bar)
    }
}
