import SwiftUI

struct BackendInstancesView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var showAddSheet = false
    @State private var deleteInstance: BackendInstance?
    @State private var showDeleteConfirm = false

    private var settings: SettingsViewModel { appVM.settingsVM }

    var body: some View {
        List {
            ForEach(settings.instances) { instance in
                NavigationLink {
                    BackendInstanceEditView(instance: instance)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(instance.name)
                                .font(.body.weight(settings.activeInstanceId == instance.id ? .semibold : .regular))
                            Text(instance.serverURLString)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        if settings.activeInstanceId == instance.id {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        deleteInstance = instance
                        showDeleteConfirm = true
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }

                    if settings.activeInstanceId != instance.id {
                        Button {
                            appVM.switchInstance(to: instance.id)
                        } label: {
                            Label("Activate", systemImage: "checkmark.circle")
                        }
                        .tint(.green)
                    }
                }
            }
        }
        .navigationTitle("Backend Instances")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showAddSheet = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showAddSheet) {
            NavigationStack {
                BackendInstanceEditView(instance: nil)
            }
        }
        .alert("Delete Instance?", isPresented: $showDeleteConfirm, presenting: deleteInstance) { instance in
            Button("Delete", role: .destructive) {
                if settings.activeInstanceId == instance.id {
                    appVM.disconnect()
                }
                settings.removeInstance(instance.id)
            }
            Button("Cancel", role: .cancel) {}
        } message: { instance in
            Text("This will permanently delete \"\(instance.name)\".")
        }
        .overlay {
            if settings.instances.isEmpty {
                ContentUnavailableView(
                    "No Instances",
                    systemImage: "server.rack",
                    description: Text("Add a backend instance to get started")
                )
            }
        }
    }
}
