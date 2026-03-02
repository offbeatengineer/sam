import SwiftUI

struct SkillEditorView: View {
    @Environment(AppViewModel.self) private var appVM
    let skill: SkillInfo
    @State private var content: String = ""
    @State private var isLoading = true
    @State private var hasChanges = false
    @State private var isSaving = false

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading...")
            } else {
                TextEditor(text: $content)
                    .font(.body.monospaced())
                    .onChange(of: content) { _, _ in
                        hasChanges = true
                    }
            }
        }
        .navigationTitle(skill.filename)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Save") {
                    isSaving = true
                    Task {
                        _ = await appVM.skillVM.saveSkill(
                            filename: skill.filename, content: content, using: appVM
                        )
                        hasChanges = false
                        isSaving = false
                    }
                }
                .disabled(!hasChanges || isSaving)
            }
        }
        .task {
            if let loaded = await appVM.skillVM.getSkillContent(filename: skill.filename, using: appVM) {
                content = loaded
            }
            isLoading = false
        }
    }
}
