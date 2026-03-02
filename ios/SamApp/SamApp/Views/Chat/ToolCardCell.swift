import SwiftUI

private let previewLineCount = 12

struct ToolCardCell: View {
    let tool: StreamingToolExecution
    @State private var isExpanded = false

    var body: some View {
        let content = Self.buildContent(tool)
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let isLong = lines.count > previewLineCount
        let displayLines = isExpanded || !isLong
            ? lines
            : Array(lines.prefix(previewLineCount))
        let remainingCount = lines.count - previewLineCount
        let isRunning = !tool.isDone && !tool.isError

        HStack {
            VStack(alignment: .leading, spacing: 0) {
                // Tap target — the entire card toggles expand/collapse
                Button {
                    guard isLong else { return }
                    withAnimation { isExpanded.toggle() }
                } label: {
                    VStack(alignment: .leading, spacing: 0) {
                        // First line — bold summary
                        if let firstLine = displayLines.first {
                            Text(firstLine)
                                .font(.caption.monospaced().bold())
                                .foregroundStyle(.primary)
                        }

                        // Remaining visible lines
                        if displayLines.count > 1 {
                            Text(displayLines.dropFirst().joined(separator: "\n"))
                                .font(.caption.monospaced())
                                .foregroundStyle(tool.isError ? .red : .secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .opacity(isRunning ? 0.7 : 1.0)

                // "N more lines" indicator
                if isLong && !isExpanded {
                    Text("... (\(remainingCount) more lines)")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary.opacity(0.6))
                        .padding(.top, 2)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(backgroundColor)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            Spacer(minLength: 40)
        }
    }

    private var backgroundColor: Color {
        if tool.isError { return Color.red.opacity(0.08) }
        if !tool.isDone { return Color.primary.opacity(0.04) }
        return Color.green.opacity(0.06)
    }

    // MARK: - Content builder (mirrors desktop ToolCard.tsx buildContent)

    static func buildContent(_ tool: StreamingToolExecution) -> String {
        var parts: [String] = []
        let args = tool.args.value as? [String: Any]

        switch tool.toolName {
        case "bash":
            if let cmd = args?["command"] as? String {
                parts.append("$ \(cmd)")
            } else {
                parts.append("bash")
            }

        case "read":
            let path = (args?["file_path"] ?? args?["path"]) as? String
            if let path {
                parts.append("read \(shortenPath(path))")
            } else {
                parts.append("read")
            }

        case "write":
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

        case "edit":
            let path = (args?["file_path"] ?? args?["path"]) as? String
            if let path {
                parts.append("edit \(shortenPath(path))")
            } else {
                parts.append("edit")
            }

        default:
            parts.append(tool.toolName)
            if let args, !args.isEmpty {
                if let data = try? JSONSerialization.data(withJSONObject: args, options: [.prettyPrinted, .sortedKeys]),
                   let json = String(data: data, encoding: .utf8) {
                    parts.append(json)
                }
            }
        }

        // Append output
        let output = tool.isDone ? tool.result : tool.partialResult
        if !output.isEmpty {
            if !parts.isEmpty { parts.append("") }
            // Truncate very long output for display
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
