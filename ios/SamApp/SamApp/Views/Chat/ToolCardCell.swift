import SwiftUI

private let collapsedLineCount = 2

struct ToolCardCell: View {
    let tool: StreamingToolExecution
    @State private var isExpanded = false

    var body: some View {
        let content = Self.buildContent(tool)
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let isLong = lines.count > collapsedLineCount
        let displayLines = isExpanded
            ? lines
            : Array(lines.prefix(collapsedLineCount))
        let remainingCount = lines.count - collapsedLineCount
        let isRunning = !tool.isDone && !tool.isError

        HStack {
            VStack(alignment: .leading, spacing: 0) {
                if let firstLine = displayLines.first {
                    Text(firstLine)
                        .font(.caption.monospaced().bold())
                        .foregroundStyle(.primary)
                        .lineLimit(isExpanded ? nil : 1)
                }

                if displayLines.count > 1 {
                    Text(displayLines.dropFirst().joined(separator: "\n"))
                        .font(.caption.monospaced())
                        .foregroundStyle(tool.isError ? (isExpanded ? .red : Color.red.opacity(0.6)) : (isExpanded ? .primary : .secondary))
                        .lineLimit(isExpanded ? nil : 1)
                }

                if isLong && !isExpanded {
                    Text("... (\(remainingCount) more lines)")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary.opacity(0.6))
                        .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .opacity(isRunning ? 0.7 : 1.0)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(backgroundColor)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
            .onTapGesture { isExpanded.toggle() }

        }
        .transaction { $0.animation = nil }
    }

    private var backgroundColor: Color {
        if tool.isError { return Color.red.opacity(0.05) }
        if !tool.isDone { return Color.primary.opacity(0.04) }
        return Color.green.opacity(0.06)
    }

    // MARK: - Content builder

    static func buildContent(_ tool: StreamingToolExecution) -> String {
        var parts: [String] = []
        let args = tool.args.value as? [String: Any]

        switch tool.toolName {
        case "bash", "Bash":
            if let cmd = args?["command"] as? String {
                parts.append("$ \(cmd)")
            } else {
                parts.append("bash")
            }

        case "read", "Read":
            let path = (args?["file_path"] ?? args?["path"]) as? String
            if let path {
                parts.append("read \(shortenPath(path))")
            } else {
                parts.append("read")
            }

        case "write", "Write":
            let path = (args?["file_path"] ?? args?["path"]) as? String
            if let path {
                parts.append("write \(shortenPath(path))")
            } else {
                parts.append("write")
            }
            if let content = args?["content"] as? String {
                parts.append("")
                parts.append(content)
            }

        case "edit", "Edit":
            let path = (args?["file_path"] ?? args?["path"]) as? String
            if let path {
                parts.append("edit \(shortenPath(path))")
            } else {
                parts.append("edit")
            }

        case "Grep", "grep":
            let pattern = args?["pattern"] as? String ?? ""
            let path = args?["path"] as? String
            if let path {
                parts.append("grep \(pattern) \(shortenPath(path))")
            } else {
                parts.append("grep \(pattern)")
            }

        case "Glob", "glob":
            let pattern = args?["pattern"] as? String ?? ""
            parts.append("glob \(pattern)")

        case "Agent":
            let desc = args?["description"] as? String ?? "subagent"
            parts.append("agent: \(desc)")

        case "manage_kit":
            let action = args?["action"] as? String ?? "manage"
            let kitId = args?["kitId"] as? String ?? ""
            parts.append("kit \(action) \(kitId)")

        default:
            parts.append(tool.toolName)
            if let args, !args.isEmpty {
                if let data = try? JSONSerialization.data(withJSONObject: args, options: [.prettyPrinted, .sortedKeys]),
                   let json = String(data: data, encoding: .utf8) {
                    parts.append(json)
                }
            }
        }

        let output = tool.isDone ? tool.result : tool.partialResult
        if !output.isEmpty {
            if !parts.isEmpty { parts.append("") }
            if output.count > 2000 {
                parts.append(String(output.prefix(2000)) + "\n... (truncated)")
            } else {
                parts.append(output)
            }
        }

        return parts.joined(separator: "\n")
    }

    private static func shortenPath(_ path: String) -> String {
        let home = NSHomeDirectory()
        if path.hasPrefix(home) {
            return "~" + path.dropFirst(home.count)
        }
        return path
    }
}
