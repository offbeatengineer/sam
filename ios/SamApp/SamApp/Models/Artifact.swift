import Foundation
import SwiftUI

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

    var iconName: String {
        if isDirectory { return "folder" }
        if isImage { return "photo" }
        if isHTML { return "globe" }
        if isCode { return "doc.text" }
        return "doc"
    }

    var iconColor: Color {
        if isImage { return .purple }
        if isHTML { return .blue }
        if isCode { return .orange }
        return .secondary
    }
}
