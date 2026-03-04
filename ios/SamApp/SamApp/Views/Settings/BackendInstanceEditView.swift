import SwiftUI

struct BackendInstanceEditView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.dismiss) private var dismiss

    /// Pass nil to create a new instance.
    let instance: BackendInstance?

    @State private var name: String = ""
    @State private var serverURLString: String = ""
    @State private var apiKeyInput: String = ""
    @State private var showApiKey = false

    private var isNew: Bool { instance == nil }
    private var isValid: Bool { !name.isEmpty && !serverURLString.isEmpty }

    var body: some View {
        Form {
            Section("Instance") {
                TextField("Name", text: $name, prompt: Text("My Server"))
                TextField("Server URL", text: $serverURLString, prompt: Text("wss://sam.yourdomain.com"))
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
            }
        }
        .navigationTitle(isNew ? "Add Instance" : "Edit Instance")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isNew {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(isNew ? "Add" : "Save") {
                    save()
                    dismiss()
                }
                .disabled(!isValid)
            }
        }
        .onAppear {
            if let instance {
                name = instance.name
                serverURLString = instance.serverURLString
                apiKeyInput = appVM.settingsVM.apiKey(for: instance.id) ?? ""
            }
        }
    }

    private func save() {
        let settings = appVM.settingsVM
        if let instance {
            var updated = instance
            updated.name = name
            updated.serverURLString = serverURLString
            settings.updateInstance(updated)
            settings.setApiKey(apiKeyInput.isEmpty ? nil : apiKeyInput, for: instance.id)
            // Reconnect if this is the active instance and URL changed
            if settings.activeInstanceId == instance.id && instance.serverURLString != serverURLString {
                appVM.disconnect()
                appVM.connect()
            }
        } else {
            _ = settings.addInstance(
                name: name,
                serverURLString: serverURLString,
                apiKey: apiKeyInput.isEmpty ? nil : apiKeyInput
            )
        }
    }
}
