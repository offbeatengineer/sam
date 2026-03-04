import SwiftUI

struct ArtifactListView: View {
    @Environment(AppViewModel.self) private var appVM

    var body: some View {
        List {
            ForEach(appVM.artifactVM.files) { file in
                NavigationLink {
                    ArtifactPreviewView(artifact: file)
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
            }
        }
        .navigationTitle("Artifacts")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await appVM.artifactVM.loadArtifacts(using: appVM)
        }
        .refreshable {
            await appVM.artifactVM.loadArtifacts(using: appVM)
        }
        .overlay {
            if appVM.artifactVM.files.isEmpty && !appVM.artifactVM.isLoading {
                ContentUnavailableView(
                    "No Artifacts",
                    systemImage: "doc.on.doc",
                    description: Text("Artifacts created by Sam will appear here")
                )
            }
        }
    }
}
