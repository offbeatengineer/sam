import SwiftUI

struct SettingsView: View {
    @Environment(AppViewModel.self) private var appVM

    var body: some View {
        Form {
            Section("Backend Instances") {
                NavigationLink {
                    BackendInstancesView()
                } label: {
                    HStack {
                        Text("Instances")
                        Spacer()
                        Text("\(appVM.settingsVM.instances.count)")
                            .foregroundStyle(.secondary)
                    }
                }

                if let active = appVM.settingsVM.activeInstance {
                    HStack {
                        Text("Active")
                        Spacer()
                        Text(active.name)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section("Status") {
                HStack {
                    Text("Connection")
                    Spacer()
                    statusBadge
                }

                Button("Connect") {
                    appVM.connect()
                }
                .disabled(appVM.settingsVM.serverURL == nil)

                Button("Disconnect") {
                    appVM.disconnect()
                }
                .foregroundStyle(.red)
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            if let artifactsURL = appVM.settingsVM.artifactsURL {
                appVM.artifactVM.artifactsBaseURL = artifactsURL
            }
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        switch appVM.connectionManager.status {
        case .disconnected:
            Label("Disconnected", systemImage: "circle")
                .foregroundStyle(.secondary)
        case .connecting:
            Label("Connecting...", systemImage: "circle.dotted")
                .foregroundStyle(.orange)
        case .connected:
            Label("Connected", systemImage: "circle.fill")
                .foregroundStyle(.green)
        case .reconnecting(let attempt):
            Label("Reconnecting (\(attempt))...", systemImage: "arrow.clockwise.circle")
                .foregroundStyle(.orange)
        case .error(let msg):
            Label(msg, systemImage: "exclamationmark.circle")
                .foregroundStyle(.red)
        }
    }
}
