import SwiftUI

struct ContentView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if appVM.connectionManager.status == .disconnected && !appVM.hasConfiguredConnection {
                NavigationStack {
                    SettingsView()
                }
            } else {
                AdaptiveMainView()
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .active:
                // Reconnect when returning to foreground
                if appVM.hasConfiguredConnection && appVM.connectionManager.status == .disconnected {
                    appVM.connect()
                }
            case .background:
                // Disconnect when going to background to free resources
                if appVM.connectionManager.status == .connected {
                    appVM.disconnect()
                }
            default:
                break
            }
        }
    }
}

/// Switches between TabView (compact) and NavigationSplitView (regular/iPad).
struct AdaptiveMainView: View {
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        if sizeClass == .regular {
            SplitMainView()
        } else {
            MainTabView()
        }
    }
}
