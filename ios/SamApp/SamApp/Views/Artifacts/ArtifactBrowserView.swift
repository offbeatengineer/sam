import SwiftUI

struct ArtifactBrowserView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var artifactVM = appVM.artifactVM

        List {
            ForEach(artifactVM.files) { file in
                Button {
                    artifactVM.selectedArtifact = file
                } label: {
                    HStack {
                        Image(systemName: file.isDirectory ? "folder" : iconName(for: file))
                            .foregroundStyle(iconColor(for: file))
                        VStack(alignment: .leading) {
                            Text(file.name)
                                .font(.body)
                            if let size = file.size {
                                Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .foregroundStyle(.primary)
            }
        }
        .navigationTitle("Artifacts")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Done") { dismiss() }
            }
        }
        .sheet(item: $artifactVM.selectedArtifact) { artifact in
            NavigationStack {
                ArtifactPreviewView(artifact: artifact)
            }
        }
        .task {
            await appVM.artifactVM.loadArtifacts(using: appVM)
        }
        .overlay {
            if artifactVM.files.isEmpty && !artifactVM.isLoading {
                ContentUnavailableView(
                    "No Artifacts",
                    systemImage: "doc",
                    description: Text("Artifacts created by Sam will appear here")
                )
            }
        }
    }

    private func iconName(for file: ArtifactFileEntry) -> String {
        if file.isImage { return "photo" }
        if file.isHTML { return "globe" }
        if file.isCode { return "doc.text" }
        return "doc"
    }

    private func iconColor(for file: ArtifactFileEntry) -> Color {
        if file.isImage { return .purple }
        if file.isHTML { return .blue }
        if file.isCode { return .orange }
        return .secondary
    }
}
