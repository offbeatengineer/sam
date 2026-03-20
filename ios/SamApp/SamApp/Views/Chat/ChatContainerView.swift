import SwiftUI
import UIKit

struct ChatContainerView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var audioPlayer = AudioPlayerManager()
    @State private var showStats = false
    @State private var showRename = false
    @State private var renameText = ""
    @State private var showSessionArtifacts = false
    @State private var navigateToSession: SessionInfo?
    @State private var highlightTimestamp: Double?
    let session: SessionInfo?

    private var isNewChat: Bool { session == nil }
    private var isReadOnly: Bool { session?.isReadOnly ?? false }

    private var hasArtifacts: Bool {
        appVM.chatVM.historicalEntries.contains { entry in
            if case .assistant(let blocks, _, _, _) = entry.message {
                return blocks.contains { block in
                    if case .toolCall(_, let name, _) = block, name == "report_artifact" { return true }
                    return false
                }
            }
            return false
        }
    }

    var body: some View {
        Group {
            if isReadOnly {
                readOnlyView
            } else {
                chatView
            }
        }
        .navigationTitle(session?.displayName ?? "New Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            if session != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showStats = true } label: {
                            Label("Stats", systemImage: "chart.bar")
                        }
                        if hasArtifacts {
                            Button { showSessionArtifacts = true } label: {
                                Label("Artifacts", systemImage: "doc.on.doc")
                            }
                        }
                        Button {
                            renameText = session?.name ?? ""
                            showRename = true
                        } label: {
                            Label("Rename", systemImage: "pencil")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .sheet(isPresented: $showStats) {
            SessionStatsSheet(entries: appVM.chatVM.historicalEntries, session: session)
        }
        .sheet(isPresented: $showSessionArtifacts) {
            NavigationStack {
                SessionArtifactsView(entries: appVM.chatVM.historicalEntries)
            }
        }
        .alert("Rename Session", isPresented: $showRename) {
            TextField("Session name", text: $renameText)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                guard let session, !renameText.isEmpty else { return }
                Task {
                    let requestId = UUID().uuidString
                    _ = try? await appVM.request(
                        .renameSession(requestId: requestId, sessionPath: session.path, name: renameText),
                        requestId: requestId
                    )
                    await appVM.sessionListVM.loadSessions(using: appVM)
                }
            }
        }
        .sheet(item: $navigateToSession) { targetSession in
            SessionPreviewSheet(
                session: targetSession,
                highlightTimestamp: highlightTimestamp,
                onDismiss: { navigateToSession = nil }
            )
            .environment(appVM)
        }
        .task {
            if let session {
                await appVM.chatVM.selectSession(session, using: appVM)
            }
        }
    }

    // MARK: - Native chat view

    private var chatView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(appVM.chatVM.chatItems) { item in
                        chatCell(for: item)
                            .padding(.vertical, 8)
                            .padding(.horizontal, 16)
                            .id(item.id)
                    }
                }
            }
            .scrollDismissesKeyboard(.immediately)
            .onTapGesture {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: appVM.chatVM.chatItems.last?.id) { _, newId in
                if let newId {
                    withAnimation(.easeOut(duration: 0.15)) {
                        proxy.scrollTo(newId, anchor: .bottom)
                    }
                }
            }
            .onChange(of: appVM.chatVM.streamingRevision) { _, _ in
                if let lastId = appVM.chatVM.chatItems.last?.id {
                    withAnimation(.easeOut(duration: 0.15)) {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            ChatInputBar(
                text: Bindable(appVM.chatVM).inputText,
                isStreaming: appVM.chatVM.isStreaming,
                onSend: { draft in
                    Task { await appVM.chatVM.sendMessage(draft: draft, using: appVM) }
                },
                onAbort: {
                    Task { await appVM.chatVM.abort(using: appVM) }
                }
            )
        }
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
                .contextMenu {
                    Button { UIPasteboard.general.string = text } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                }

        case .markdown(let text):
            MarkdownMessageCell(text: text)
                .contextMenu {
                    Button { UIPasteboard.general.string = text } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                }

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
            SessionSearchCardCell(details: details, onNavigate: handleSessionNavigate)

        case .sessionReadCard(let details):
            SessionReadCardCell(details: details, onNavigate: handleSessionNavigate)

        case .kitCreateCard(let details):
            KitCreateCardCell(details: details)

        case .streamingIndicator:
            StreamingDotsView()

        case .systemEvent(let text):
            SystemEventCell(text: text)

        case .imageAttachment(let image, let caption):
            imageBubble(image, caption: caption)

        case .remoteImageAttachment(let remotePath, let caption):
            remoteImageBubble(remotePath: remotePath, caption: caption)

        case .audioAttachment(let caption, let localURL):
            audioBubble(id: item.id, caption: caption, localURL: localURL, remotePath: nil)

        case .remoteAudioAttachment(let remotePath):
            audioBubble(id: item.id, caption: nil, localURL: nil, remotePath: remotePath)
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

    private func audioBubble(id: String, caption: String?, localURL: URL?, remotePath: String?) -> some View {
        let isActive = audioPlayer.currentlyPlayingId == id
        let playing = isActive && audioPlayer.isPlaying

        return HStack {
            Spacer()
            Button {
                if let localURL {
                    audioPlayer.play(id: id, url: localURL)
                } else if let remotePath, let url = buildFullURL(remotePath: remotePath) {
                    audioPlayer.playStreaming(id: id, url: url)
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: playing ? "pause.circle.fill" : "play.circle.fill")
                        .font(.title2)
                        .contentTransition(.symbolEffect(.replace))

                    if isActive {
                        GeometryReader { geo in
                            Capsule()
                                .fill(.white.opacity(0.35))
                                .frame(height: 4)
                                .frame(maxHeight: .infinity, alignment: .center)
                                .overlay(alignment: .leading) {
                                    Capsule()
                                        .fill(.white)
                                        .frame(width: geo.size.width * audioPlayer.progress, height: 4)
                                }
                        }
                        .frame(height: 20)
                    } else {
                        Image(systemName: "waveform")
                            .font(.callout)
                    }

                    if let caption {
                        Text(caption)
                            .font(.subheadline)
                    }
                }
                .frame(minWidth: 120)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.blue)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    /// Build a full URL from a remote path, matching the pattern used by remoteImageBubble.
    private func buildFullURL(remotePath: String) -> URL? {
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
    }


    // MARK: - Session navigation

    private func handleSessionNavigate(_ conversationId: String, _ timestamp: Double) {
        guard let match = appVM.sessionListVM.sessions.first(where: { $0.conversationId == conversationId }) else { return }
        navigateToSession = match
        highlightTimestamp = timestamp
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
