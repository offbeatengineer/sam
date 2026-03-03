import SwiftUI

struct NewMemoryView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.dismiss) private var dismiss
    @State private var text: String = ""
    @State private var tagsString: String = ""
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Content") {
                    TextEditor(text: $text)
                        .frame(minHeight: 150)
                }

                Section("Tags") {
                    TextField("Tags (comma separated)", text: $tagsString)
                }
            }
            .navigationTitle("New Memory")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        isSaving = true
                        Task {
                            let tags = tagsString.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                            let success = await appVM.memoryVM.saveMemory(text: text, tags: tags, using: appVM)
                            if success { dismiss() }
                            isSaving = false
                        }
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
        }
    }
}
