import SwiftUI

struct SettingsView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var apiKeyInput: String = ""
    @State private var showApiKey = false

    var body: some View {
        @Bindable var settings = appVM.settingsVM

        Form {
            Section("Connection") {
                TextField("Server URL", text: $settings.serverURLString, prompt: Text("wss://sam.yourdomain.com"))
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)

                TextField("Artifacts URL", text: $settings.artifactsURLString, prompt: Text("https://sam-artifacts.yourdomain.com"))
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }

            Section("Authentication") {
                HStack {
                    if showApiKey {
                        TextField("API Key", text: $apiKeyInput)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                    } else {
                        SecureField("API Key", text: $apiKeyInput)
                    }
                    Button {
                        showApiKey.toggle()
                    } label: {
                        Image(systemName: showApiKey ? "eye.slash" : "eye")
                    }
                }
                .onChange(of: apiKeyInput) { _, newValue in
                    settings.apiKey = newValue.isEmpty ? nil : newValue
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
                .disabled(settings.serverURL == nil)

                Button("Disconnect") {
                    appVM.disconnect()
                }
                .foregroundStyle(.red)
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            apiKeyInput = settings.apiKey ?? ""
            if let artifactsURL = settings.artifactsURL {
                appVM.artifactVM.artifactsBaseURL = artifactsURL
            }
        }
        .onChange(of: settings.artifactsURLString) { _, _ in
            if let artifactsURL = settings.artifactsURL {
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
