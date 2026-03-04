import SwiftUI

struct MainTabView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                SessionListView()
            }
            .tabItem {
                Label("Chat", systemImage: "bubble.left.and.bubble.right")
            }
            .tag(0)

            NavigationStack {
                MemoryListView()
            }
            .tabItem {
                Label("Memory", systemImage: "brain")
            }
            .tag(1)

            NavigationStack {
                SkillListView()
            }
            .tabItem {
                Label("Skills", systemImage: "hammer")
            }
            .tag(2)

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("Settings", systemImage: "gear")
            }
            .tag(3)
        }
        .onAppear {
            if appVM.hasConfiguredConnection {
                appVM.connect()
            }
        }
    }
}
