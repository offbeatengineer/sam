import SwiftUI

/// A read-only session viewer for the navigation sheet.
/// Loads its own entries independently, so it doesn't clobber the shared ChatViewModel state.
struct SessionPreviewSheet: View {
    @Environment(AppViewModel.self) private var appVM
    let session: SessionInfo
    let highlightTimestamp: Double?
    let onDismiss: () -> Void

    @State private var entries: [SessionEntry] = []
    @State private var chatItems: [ChatMessageItem] = []

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(chatItems) { item in
                            cellView(for: item)
                                .padding(.vertical, 8)
                                .padding(.horizontal, 16)
                                .id(item.id)
                        }
                    }
                }
                .onChange(of: chatItems.count) { _, _ in
                    scrollToHighlight(proxy: proxy)
                }
            }
            .navigationTitle(session.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { onDismiss() }
                }
            }
        }
        .task {
            await loadEntries()
        }
    }

    private func loadEntries() async {
        let requestId = UUID().uuidString
        do {
            let response = try await appVM.request(
                .getSessionEntries(requestId: requestId, sessionPath: session.path),
                requestId: requestId
            )
            if case .sessionEntries(_, _, let rawEntries) = response {
                entries = rawEntries.compactMap { SessionEntry.parse(from: $0) }
                chatItems = ChatMessageItem.fromEntries(entries)
            }
        } catch {
            print("[SessionPreview] Failed to load entries: \(error)")
        }
    }

    private func scrollToHighlight(proxy: ScrollViewProxy) {
        guard let ts = highlightTimestamp, !chatItems.isEmpty else { return }
        // Find the item closest to the highlight timestamp
        let targetDate = Date(timeIntervalSince1970: ts)
        let closest = chatItems.min(by: {
            abs($0.timestamp.timeIntervalSince(targetDate)) < abs($1.timestamp.timeIntervalSince(targetDate))
        })
        if let id = closest?.id {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                withAnimation {
                    proxy.scrollTo(id, anchor: .center)
                }
            }
        }
    }

    // MARK: - Cell dispatcher (simplified, read-only)

    @ViewBuilder
    private func cellView(for item: ChatMessageItem) -> some View {
        switch item.content {
        case .text(let text):
            HStack {
                Spacer()
                Text(text)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.blue)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }

        case .markdown(let text):
            MarkdownMessageCell(text: text)

        case .thinking(let text, let done):
            ThinkingCell(text: text, isDone: done)

        case .toolExecution(let tool):
            ToolCardCell(tool: tool)

        case .artifactCard(_, _, let title, let path):
            ArtifactCardCell(title: title, artifactPath: path)

        case .webSearchResults(let details):
            WebSearchCardCell(details: details)

        case .webFetchPage(let details):
            WebFetchCardCell(details: details)

        case .memoryCard(let details):
            MemoryCardCell(details: details)

        case .memoryRecall(let details):
            MemoryRecallCardCell(details: details)

        case .sessionSearchCard(let details):
            SessionSearchCardCell(details: details)

        case .sessionReadCard(let details):
            SessionReadCardCell(details: details)

        case .kitCreateCard(let details):
            KitCreateCardCell(details: details)

        case .systemEvent(let text):
            SystemEventCell(text: text)

        default:
            EmptyView()
        }
    }
}
