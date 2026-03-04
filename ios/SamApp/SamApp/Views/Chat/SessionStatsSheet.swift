import SwiftUI

struct SessionStatsSheet: View {
    let entries: [SessionEntry]
    let session: SessionInfo?
    @Environment(\.dismiss) private var dismiss

    private var stats: Stats {
        var s = Stats()
        var models = Set<String>()

        for entry in entries {
            guard let msg = entry.message else { continue }
            switch msg {
            case .user:
                s.userMessages += 1
            case .assistant(let blocks, let model, let provider, let usage):
                s.assistantMessages += 1
                if let model {
                    let display = provider != nil ? "\(provider!)/\(model)" : model
                    models.insert(display)
                }
                if let usage {
                    s.tokensIn += usage.input
                    s.tokensOut += usage.output
                    s.cacheRead += usage.cacheRead
                    s.cacheWrite += usage.cacheWrite
                    s.cost += usage.costTotal
                }
                s.toolCalls += blocks.filter {
                    if case .toolCall = $0 { return true }
                    return false
                }.count
            default:
                break
            }
        }
        s.models = models.sorted()
        return s
    }

    var body: some View {
        NavigationStack {
            List {
                if let session {
                    row("Date", value: formatDate(session.created))
                }
                if !stats.models.isEmpty {
                    row("Model", value: stats.models.joined(separator: ", "))
                }
                row("Messages", value: "\(stats.userMessages + stats.assistantMessages) (\(stats.userMessages) user, \(stats.assistantMessages) assistant)")
                row("Tool calls", value: "\(stats.toolCalls)")
                if stats.tokensIn + stats.tokensOut + stats.cacheRead > 0 {
                    let parts = [
                        stats.tokensIn > 0 ? "\(formatTokens(stats.tokensIn)) in" : nil,
                        stats.tokensOut > 0 ? "\(formatTokens(stats.tokensOut)) out" : nil,
                        stats.cacheRead > 0 ? "\(formatTokens(stats.cacheRead)) cache" : nil,
                    ].compactMap { $0 }
                    row("Tokens", value: parts.joined(separator: ", "))
                }
                row("Cost", value: String(format: "$%.3f", stats.cost))
            }
            .navigationTitle("Session Stats")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func row(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .multilineTextAlignment(.trailing)
        }
    }

    private func formatTokens(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return String(format: "%.1fk", Double(n) / 1_000) }
        return "\(n)"
    }

    private func formatDate(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        let fmt = DateFormatter()
        fmt.dateStyle = .medium
        fmt.timeStyle = .short
        return fmt.string(from: date)
    }
}

private struct Stats {
    var userMessages = 0
    var assistantMessages = 0
    var toolCalls = 0
    var tokensIn = 0
    var tokensOut = 0
    var cacheRead = 0
    var cacheWrite = 0
    var cost: Double = 0
    var models: [String] = []
}
