import Foundation

struct ArtifactFileEntry: Identifiable, Hashable {
    let name: String
    let path: String
    let size: Int?
    let isDirectory: Bool

    var id: String { path }

    var fileExtension: String {
        (name as NSString).pathExtension.lowercased()
    }

    var isImage: Bool {
        ["png", "jpg", "jpeg", "gif", "webp", "svg"].contains(fileExtension)
    }

    var isHTML: Bool {
        fileExtension == "html" || fileExtension == "htm"
    }

    var isCode: Bool {
        ["js", "ts", "py", "swift", "rs", "go", "css", "json", "yaml", "yml", "md", "txt"].contains(fileExtension)
    }
}
