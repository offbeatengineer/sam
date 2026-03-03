import SwiftUI

struct SessionListView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var renamingSession: SessionInfo?
    @State private var renameText = ""
    @State private var deleteSession: SessionInfo?
    @State private var showDeleteConfirm = false
    @State private var showNewChat = false

    var body: some View {
        List {
            ForEach(appVM.sessionListVM.groupedSessions, id: \.channelId) { group in
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
        }
        .listStyle(.sidebar)
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
            await appVM.sessionListVM.loadSessions(using: appVM)
        }
        .overlay {
            if appVM.sessionListVM.sessions.isEmpty && !appVM.sessionListVM.isLoading {
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
