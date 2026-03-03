import SwiftUI

struct MemoryDetailView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.dismiss) private var dismiss
    let memory: MemoryItem
    @State private var editedText: String = ""
    @State private var editedTags: String = ""
    @State private var isEditing = false
    @State private var showDeleteConfirmation = false

    var body: some View {
        Form {
            Section("Content") {
                if isEditing {
                    TextEditor(text: $editedText)
                        .frame(minHeight: 150)
                } else {
                    Text(memory.text)
                }
            }

            Section("Tags") {
                if isEditing {
                    TextField("Tags (comma separated)", text: $editedTags)
                } else {
                    if memory.tags.isEmpty {
                        Text("No tags")
                            .foregroundStyle(.secondary)
                    } else {
                        FlowLayout(spacing: 6) {
                            ForEach(memory.tags, id: \.self) { tag in
                                Text(tag)
                                    .font(.caption)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(.blue.opacity(0.1))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
            }

            Section("Info") {
                LabeledContent("Source", value: memory.source)
                LabeledContent("Created", value: memory.createdDate, format: .dateTime)
                if memory.score > 0 {
                    LabeledContent("Score", value: String(format: "%.3f", memory.score))
                }
            }
        }
        .navigationTitle("Memory")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if isEditing {
                    Button("Save") {
                        Task {
                            let tags = editedTags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                            let success = await appVM.memoryVM.updateMemory(
                                id: memory.id, text: editedText, tags: tags, using: appVM
                            )
                            if success { isEditing = false }
                        }
                    }
                } else {
                    Menu {
                        Button("Edit") {
                            editedText = memory.text
                            editedTags = memory.tags.joined(separator: ", ")
                            isEditing = true
                        }
                        Button("Delete", role: .destructive) {
                            showDeleteConfirmation = true
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .confirmationDialog("Delete this memory?", isPresented: $showDeleteConfirmation) {
            Button("Delete", role: .destructive) {
                Task {
                    let success = await appVM.memoryVM.deleteMemory(id: memory.id, using: appVM)
                    if success { dismiss() }
                }
            }
        }
    }
}

// Simple flow layout for tags
struct FlowLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layout(subviews: subviews, width: proposal.width ?? .infinity)
        return CGSize(width: proposal.width ?? result.width, height: result.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX && x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }

    private func layout(subviews: Subviews, width: CGFloat) -> (width: CGFloat, height: CGFloat) {
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > width && x > 0 {
                maxWidth = max(maxWidth, x - spacing)
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }

        return (max(maxWidth, x - spacing), y + rowHeight)
    }
}
