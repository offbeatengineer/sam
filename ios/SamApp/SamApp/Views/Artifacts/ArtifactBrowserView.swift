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
                        Image(systemName: file.iconName)
                            .foregroundStyle(file.iconColor)
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
            ArtifactPreviewView(artifact: artifact)
                .presentationDragIndicator(.visible)
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

}
