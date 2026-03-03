import Foundation

@Observable
final class ArtifactViewModel {
    var files: [ArtifactFileEntry] = []
    var isLoading = false
    var selectedArtifact: ArtifactFileEntry?
    var artifactsBaseURL: URL?
    var error: String?

    /// Load artifact file listing from the artifacts HTTP server.
    func loadArtifacts(using app: AppViewModel) async {
        guard let baseURL = artifactsBaseURL else { return }
        isLoading = true
        do {
            let url = baseURL.appendingPathComponent("__files")
            let (data, _) = try await URLSession.shared.data(from: url)
            let listing = try JSONDecoder().decode([ArtifactListEntry].self, from: data)
            await MainActor.run {
                self.files = listing.map { entry in
                    ArtifactFileEntry(
                        name: entry.name,
                        path: entry.path,
                        size: entry.size,
                        isDirectory: entry.isDirectory
                    )
                }
                self.isLoading = false
                self.error = nil
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    func artifactURL(for artifact: ArtifactFileEntry) -> URL? {
        artifactsBaseURL?.appendingPathComponent(artifact.path)
    }
}

private struct ArtifactListEntry: Decodable {
    let name: String
    let path: String
    let size: Int?
    let mtime: String?
    let isDirectory: Bool
}
