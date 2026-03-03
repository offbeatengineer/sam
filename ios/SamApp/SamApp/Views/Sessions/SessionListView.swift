import SwiftUI

struct SessionListView: View {
    @Environment(AppViewModel.self) private var appVM

    var body: some View {
        List {
            ForEach(appVM.sessionListVM.groupedSessions, id: \.channelId) { group in
                Section(group.channelId.capitalized) {
                    ForEach(group.sessions) { session in
                        NavigationLink(value: session) {
                            SessionRowView(session: session, isStreaming: appVM.chatVM.isStreaming && appVM.chatVM.activeConversationId == session.conversationId)
                        }
                    }
                }
            }
        }
        .navigationTitle("Sessions")
        .navigationDestination(for: SessionInfo.self) { session in
            ChatContainerView(session: session)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task {
                        await appVM.chatVM.sendMessageToNewSession(using: appVM)
                    }
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
    }
}
