import SwiftUI

struct SessionListView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var renamingSession: SessionInfo?
    @State private var renameText = ""
    @State private var deleteSession: SessionInfo?
    @State private var showDeleteConfirm = false
    @State private var showNewChat = false

    /// Sessions filtered by search results when a search is active.
    private var filteredGroupedSessions: [(channelId: String, sessions: [SessionInfo])] {
        guard let matchingIds = appVM.sessionSearchVM.matchingIds else {
            return appVM.sessionListVM.groupedSessions
        }
        return appVM.sessionListVM.groupedSessions.compactMap { group in
            let filtered = group.sessions.filter { matchingIds.contains($0.conversationId) }
            guard !filtered.isEmpty else { return nil }
            return (channelId: group.channelId, sessions: filtered)
        }
    }

    var body: some View {
        @Bindable var searchVM = appVM.sessionSearchVM

        List {
            ForEach(filteredGroupedSessions, id: \.channelId) { group in
                Section(isExpanded: appVM.sessionListVM.bindingForChannel(group.channelId)) {
                    ForEach(group.sessions) { session in
                        NavigationLink(value: session) {
                            if renamingSession?.id == session.id {
                                inlineRenameField(session: session)
                            } else {
                                SessionRowView(
                                    session: session,
                                    isStreaming: appVM.streamingConversations.contains(session.conversationId)
                                )
                            }
                        }
                        .disabled(renamingSession?.id == session.id)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if !session.isReadOnly {
                                Button(role: .destructive) {
                                    deleteSession = session
                                    showDeleteConfirm = true
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }

                                Button {
                                    Task {
                                        _ = await appVM.sessionListVM.archiveSession(
                                            sessionPath: session.path, using: appVM
                                        )
                                    }
                                } label: {
                                    Label("Archive", systemImage: "archivebox")
                                }
                                .tint(.indigo)

                                Button {
                                    beginRename(session)
                                } label: {
                                    Label("Rename", systemImage: "pencil")
                                }
                                .tint(.orange)
                            }
                        }
                        .contextMenu {
                            if !session.isReadOnly {
                                Button {
                                    beginRename(session)
                                } label: {
                                    Label("Rename", systemImage: "pencil")
                                }

                                Button {
                                    Task {
                                        _ = await appVM.sessionListVM.archiveSession(
                                            sessionPath: session.path, using: appVM
                                        )
                                    }
                                } label: {
                                    Label("Archive", systemImage: "archivebox")
                                }

                                Button(role: .destructive) {
                                    deleteSession = session
                                    showDeleteConfirm = true
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                } header: {
                    channelHeader(group.channelId, count: group.sessions.count)
                }
            }

            // Archived sessions — lazy loaded on expand
            Section(isExpanded: Binding(
                get: { !appVM.sessionListVM.collapsedChannels.contains("archived") },
                set: { expanded in
                    if expanded {
                        appVM.sessionListVM.collapsedChannels.remove("archived")
                        if !appVM.sessionListVM.archivedLoaded {
                            Task { await appVM.sessionListVM.loadArchivedSessions(using: appVM) }
                        }
                    } else {
                        appVM.sessionListVM.collapsedChannels.insert("archived")
                    }
                }
            )) {
                if appVM.sessionListVM.archivedSessions.isEmpty {
                    if appVM.sessionListVM.archivedLoaded {
                        Text("No archived sessions")
                            .foregroundStyle(.secondary)
                            .font(.caption)
                    } else {
                        ProgressView()
                    }
                } else {
                    ForEach(appVM.sessionListVM.archivedSessions) { session in
                        NavigationLink(value: session) {
                            SessionRowView(
                                session: session,
                                isStreaming: false
                            )
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button {
                                Task {
                                    _ = await appVM.sessionListVM.unarchiveSession(
                                        sessionPath: session.path, using: appVM
                                    )
                                }
                            } label: {
                                Label("Unarchive", systemImage: "tray.and.arrow.up")
                            }
                            .tint(.blue)
                        }
                        .contextMenu {
                            Button {
                                Task {
                                    _ = await appVM.sessionListVM.unarchiveSession(
                                        sessionPath: session.path, using: appVM
                                    )
                                }
                            } label: {
                                Label("Unarchive", systemImage: "tray.and.arrow.up")
                            }
                        }
                    }
                }
            } header: {
                HStack {
                    Image(systemName: "archivebox")
                        .font(.caption)
                    Text("Archived")
                }
            }
        }
        .listStyle(.sidebar)
        .searchable(text: $searchVM.searchQuery, prompt: "Search sessions")
        .onSubmit(of: .search) {
            Task { await appVM.sessionSearchVM.search(using: appVM) }
        }
        .onChange(of: appVM.sessionSearchVM.searchQuery) { _, newValue in
            if newValue.isEmpty {
                appVM.sessionSearchVM.clear()
            }
        }
        .navigationTitle("Sessions")
        .navigationDestination(for: SessionInfo.self) { session in
            ChatContainerView(session: session)
        }
        .navigationDestination(isPresented: $showNewChat) {
            ChatContainerView(session: nil)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    appVM.chatVM.prepareNewSession()
                    showNewChat = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .refreshable {
            await appVM.sessionListVM.loadSessions(using: appVM)
        }
        .task {
            // Only load on appear if already connected; otherwise onConnected handles it
            guard appVM.connectionManager.status == .connected else { return }
            await appVM.sessionListVM.loadSessions(using: appVM)
        }
        .overlay {
            if appVM.sessionListVM.isLoading && appVM.sessionListVM.sessions.isEmpty {
                ProgressView("Loading sessions…")
            } else if let error = appVM.sessionListVM.error, appVM.sessionListVM.sessions.isEmpty {
                ContentUnavailableView {
                    Label("Connection Error", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") {
                        Task { await appVM.sessionListVM.loadSessions(using: appVM) }
                    }
                }
            } else if appVM.sessionListVM.sessions.isEmpty {
                ContentUnavailableView(
                    "No Sessions",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Start a new chat to create a session")
                )
            }
        }
        .alert("Delete Session?", isPresented: $showDeleteConfirm, presenting: deleteSession) { session in
            Button("Delete", role: .destructive) {
                Task {
                    try? await appVM.send(.closeSession(conversationId: session.conversationId))
                    await appVM.sessionListVM.loadSessions(using: appVM)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { session in
            Text("This will permanently delete \"\(session.displayName)\".")
        }
    }

    // MARK: - Channel header

    private func channelHeader(_ channelId: String, count: Int) -> some View {
        HStack {
            Circle()
                .fill(channelColor(channelId))
                .frame(width: 8, height: 8)
            Text(channelId.capitalized)
            Spacer()
            Text("\(count)")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func channelColor(_ channelId: String) -> Color {
        switch channelId {
        case "app": return .green
        case "discord": return .indigo
        case "pulse": return .orange
        default: return .gray
        }
    }

    // MARK: - Inline rename

    private func beginRename(_ session: SessionInfo) {
        renameText = session.name ?? session.firstMessage.prefix(50).description
        renamingSession = session
    }

    @ViewBuilder
    private func inlineRenameField(session: SessionInfo) -> some View {
        TextField("Session name", text: $renameText)
            .textFieldStyle(.roundedBorder)
            .onSubmit { commitRename(session) }
            .onAppear {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {}
            }
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Cancel") {
                        renamingSession = nil
                    }
                    Button("Done") {
                        commitRename(session)
                    }
                    .fontWeight(.semibold)
                }
            }
    }

    private func commitRename(_ session: SessionInfo) {
        let name = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != session.name else {
            renamingSession = nil
            return
        }
        let sessionPath = session.path
        renamingSession = nil
        Task {
            _ = await appVM.sessionListVM.renameSession(sessionPath: sessionPath, name: name, using: appVM)
        }
    }
}
