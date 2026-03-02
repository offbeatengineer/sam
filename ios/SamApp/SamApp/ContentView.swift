import SwiftUI

struct ContentView: View {
    @Environment(AppViewModel.self) private var appVM

    var body: some View {
        Group {
            if appVM.connectionManager.status == .disconnected && !appVM.hasConfiguredConnection {
                SettingsView()
            } else {
                MainTabView()
            }
        }
    }
}
