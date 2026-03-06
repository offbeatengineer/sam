import SwiftUI

/// iPad layout with sidebar (sessions) + detail (chat) + secondary navigation.
struct SplitMainView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var selectedSession: SessionInfo?
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    @State private var showMemory = false
    @State private var showSkills = false
    @State private var showSettings = false
    @State private var showNewChat = false

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            sidebar
        } detail: {
            detail
        }
        .onAppear {
            if appVM.hasConfiguredConnection {
                appVM.connect()
            }
        }
        .sheet(isPresented: $showMemory) {
            NavigationStack {
                MemoryListView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showMemory = false }
                        }
                    }
            }
        }
        .sheet(isPresented: $showSkills) {
            NavigationStack {
                SkillListView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showSkills = false }
                        }
                    }
            }
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                SettingsView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showSettings = false }
                        }
                    }
            }
        }
    }

    // MARK: - Sidebar

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

    private var sidebar: some View {
        List(selection: $selectedSession) {
            ForEach(filteredGroupedSessions, id: \.channelId) { group in
                Section(isExpanded: appVM.sessionListVM.bindingForChannel(group.channelId)) {
                    ForEach(group.sessions) { session in
                        SessionRowView(
                            session: session,
                            isStreaming: appVM.streamingConversations.contains(session.conversationId)
                        )
                        .tag(session)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if !session.isReadOnly {
                                Button(role: .destructive) {
                                    Task {
                                        try? await appVM.send(.closeSession(conversationId: session.conversationId))
                                        await appVM.sessionListVM.loadSessions(using: appVM)
                                    }
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
        }
        .listStyle(.sidebar)
        .searchable(text: Bindable(appVM.sessionSearchVM).searchQuery, prompt: "Search sessions")
        .onSubmit(of: .search) {
            Task { await appVM.sessionSearchVM.search(using: appVM) }
        }
        .onChange(of: appVM.sessionSearchVM.searchQuery) { _, newValue in
            if newValue.isEmpty {
                appVM.sessionSearchVM.clear()
            }
        }
        .navigationTitle("Sam")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    appVM.chatVM.prepareNewSession()
                    selectedSession = nil
                    showNewChat = true
                } label: {
                    Image(systemName: "plus")
                }
            }

            ToolbarItemGroup(placement: .secondaryAction) {
                Button { showMemory = true } label: {
                    Label("Memory", systemImage: "brain")
                }
                Button { showSkills = true } label: {
                    Label("Skills", systemImage: "hammer")
                }
                Button { showSettings = true } label: {
                    Label("Settings", systemImage: "gear")
                }
            }
        }
        .refreshable {
            await appVM.sessionListVM.loadSessions(using: appVM)
        }
        .task {
            await appVM.sessionListVM.loadSessions(using: appVM)
        }
        .onChange(of: selectedSession) { _, session in
            guard let session else { return }
            showNewChat = false
            Task {
                await appVM.chatVM.selectSession(session, using: appVM)
            }
        }
    }

    // MARK: - Detail

    @ViewBuilder
    private var detail: some View {
        if showNewChat {
            ChatContainerView(session: nil)
        } else if let session = selectedSession {
            ChatContainerView(session: session)
        } else {
            ContentUnavailableView(
                "Select a Session",
                systemImage: "bubble.left.and.bubble.right",
                description: Text("Choose a session from the sidebar or start a new chat")
            )
        }
    }

    // MARK: - Helpers

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
}
