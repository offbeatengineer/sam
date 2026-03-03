import SwiftUI

struct SkillListView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var showNewSkill = false
    @State private var newSkillName = ""

    var body: some View {
        List {
            ForEach(appVM.skillVM.skills) { skill in
                NavigationLink(value: skill) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(skill.filename)
                            .font(.body.monospaced())

                        HStack(spacing: 8) {
                            Text(skill.modifiedDate, style: .relative)
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            Text(ByteCountFormatter.string(fromByteCount: Int64(skill.size), countStyle: .file))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .swipeActions(edge: .trailing) {
                    Button("Delete", role: .destructive) {
                        Task {
                            _ = await appVM.skillVM.deleteSkill(filename: skill.filename, using: appVM)
                        }
                    }
                }
            }
        }
        .navigationTitle("Skills")
        .navigationDestination(for: SkillInfo.self) { skill in
            SkillEditorView(skill: skill)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showNewSkill = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .alert("New Skill", isPresented: $showNewSkill) {
            TextField("Filename (e.g., my-skill.md)", text: $newSkillName)
            Button("Create") {
                guard !newSkillName.isEmpty else { return }
                let filename = newSkillName.hasSuffix(".md") ? newSkillName : "\(newSkillName).md"
                Task {
                    _ = await appVM.skillVM.saveSkill(filename: filename, content: "# \(newSkillName)\n\n", using: appVM)
                    newSkillName = ""
                }
            }
            Button("Cancel", role: .cancel) { newSkillName = "" }
        }
        .refreshable {
            await appVM.skillVM.loadSkills(using: appVM)
        }
        .task {
            await appVM.skillVM.loadSkills(using: appVM)
        }
        .overlay {
            if appVM.skillVM.skills.isEmpty && !appVM.skillVM.isLoading {
                ContentUnavailableView(
                    "No Skills",
                    systemImage: "hammer",
                    description: Text("Create skills to extend Sam's capabilities")
                )
            }
        }
    }
}
