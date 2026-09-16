import SwiftUI

/// A compact, expandable line showing what automatic memory did around a turn.
struct MemoryActivityCell: View {
    let activity: MemoryActivity
    @State private var expanded = false

    private struct Row: Identifiable {
        let id = UUID()
        let label: String
        let text: String
        var detail: String? = nil
    }

    private var summary: String {
        if activity.isRecall {
            let n = activity.memories?.count ?? 0
            return "Recalled \(n) \(n == 1 ? "memory" : "memories")"
        }
        var parts: [String] = []
        if let n = activity.saved?.count, n > 0 { parts.append("saved \(n)") }
        if let n = activity.superseded?.count, n > 0 { parts.append("updated \(n)") }
        if let n = activity.forgotten?.count, n > 0 { parts.append("forgot \(n)") }
        if let n = activity.duplicates?.count, n > 0 { parts.append("\(n) already known") }
        if let n = activity.flagged?.count, n > 0 { parts.append("\(n) to review") }
        if activity.unresolvedForget == true { parts.append("nothing matched to forget") }
        return "Memory: " + parts.joined(separator: ", ")
    }

    private var rows: [Row] {
        if activity.isRecall {
            return (activity.memories ?? []).map { m in
                Row(label: m.p.map { "\(Int(($0 * 100).rounded()))%" } ?? "Recalled", text: m.text)
            }
        }
        var rows: [Row] = []
        rows += (activity.saved ?? []).map { Row(label: $0.kind == "profile" ? "Saved · always" : "Saved", text: $0.text) }
        rows += (activity.superseded ?? []).map { Row(label: "Updated", text: $0.text, detail: $0.replaced.map { "was: \($0.text)" }) }
        rows += (activity.forgotten ?? []).map { Row(label: "Forgot", text: $0.text) }
        rows += (activity.duplicates ?? []).map { Row(label: "Known", text: $0.text) }
        rows += (activity.flagged ?? []).map { Row(label: "Review", text: $0.text, detail: "may be outdated, left unchanged") }
        return rows
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "brain.head.profile")
                    Text(summary)
                    if !rows.isEmpty {
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .rotationEffect(.degrees(expanded ? 90 : 0))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .disabled(rows.isEmpty)

            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(rows) { row in
                        HStack(alignment: .top, spacing: 8) {
                            Text(row.label)
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.12))
                                .foregroundStyle(.secondary)
                                .clipShape(Capsule())
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.text).font(.caption)
                                if let detail = row.detail {
                                    Text(detail)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .strikethrough(row.label == "Updated")
                                }
                            }
                            Spacer(minLength: 0)
                        }
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}
