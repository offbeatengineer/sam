import SwiftUI

struct SessionArtifactInfo: Identifiable {
    let id: String      // toolCallId
    let title: String
    let path: String?
}

struct SessionArtifactsView: View {
    @Environment(\.dismiss) private var dismiss
    let entries: [SessionEntry]

    private var artifacts: [SessionArtifactInfo] {
        // Build toolResults map for details lookup
        var toolResultsMap: [String: AnyCodable] = [:]
        for entry in entries {
            if case .toolResult(let toolCallId, _, _, _, let details) = entry.message, let details {
                toolResultsMap[toolCallId] = details
            }
        }

        // Collect all, then dedup by path (keep last occurrence for most recent title)
        var all: [SessionArtifactInfo] = []
        for entry in entries {
            guard case .assistant(let blocks, _, _, _) = entry.message else { continue }
            for block in blocks {
                if case .toolCall(let toolId, let name, let arguments) = block, name == "report_artifact" {
                    let details = toolResultsMap[toolId]
                    let title = (details?.value as? [String: Any])?["title"] as? String
                        ?? (arguments.value as? [String: Any])?["title"] as? String
                        ?? "Artifact"
                    let path = (details?.value as? [String: Any])?["path"] as? String
                        ?? (arguments.value as? [String: Any])?["path"] as? String
                    all.append(SessionArtifactInfo(id: toolId, title: title, path: path))
                }
            }
        }

        // Dedup: for artifacts with a path, keep only the last report
        var seenPaths: [String: Int] = [:]
        var result: [SessionArtifactInfo] = []
        for item in all {
            if let path = item.path {
                if let existing = seenPaths[path] {
                    result[existing] = item
                } else {
                    seenPaths[path] = result.count
                    result.append(item)
                }
            } else {
                result.append(item)
            }
        }
        return result
    }

    var body: some View {
        Group {
            if artifacts.isEmpty {
                ContentUnavailableView(
                    "No Artifacts",
                    systemImage: "doc.on.doc",
                    description: Text("No artifacts in this session")
                )
            } else {
                List(artifacts) { artifact in
                    if let path = artifact.path {
                        NavigationLink {
                            ArtifactPreviewView(artifact: ArtifactFileEntry(
                                name: (path as NSString).lastPathComponent,
                                path: path,
                                size: nil,
                                isDirectory: false
                            ))
                        } label: {
                            artifactLabel(artifact)
                        }
                    } else {
                        artifactLabel(artifact)
                    }
                }
            }
        }
        .navigationTitle("Session Artifacts")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    private func artifactLabel(_ artifact: SessionArtifactInfo) -> some View {
        HStack {
            Image(systemName: iconName(for: artifact))
                .foregroundStyle(.blue)
            Text(artifact.title)
                .font(.body)
        }
    }

    private func iconName(for artifact: SessionArtifactInfo) -> String {
        guard let path = artifact.path else { return "doc.richtext" }
        let ext = (path as NSString).pathExtension.lowercased()
        if ["png", "jpg", "jpeg", "gif", "webp", "svg"].contains(ext) { return "photo" }
        if ext == "html" || ext == "htm" { return "globe" }
        if ["js", "ts", "py", "swift", "rs", "go", "css", "json", "yaml", "yml", "md", "txt"].contains(ext) { return "doc.text" }
        return "doc.richtext"
    }
}
