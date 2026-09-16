import SwiftUI

struct MemoryListView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var showNewMemory = false

    var body: some View {
        @Bindable var memoryVM = appVM.memoryVM

        List {
            ForEach(appVM.memoryVM.memories) { memory in
                NavigationLink(value: memory) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(memory.text)
                            .font(.body)
                            .lineLimit(3)
                            .strikethrough(!memory.isActive)
                            .foregroundStyle(memory.isActive ? .primary : .secondary)

                        HStack(spacing: 6) {
                            if memory.isProfile {
                                Text("always")
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 1)
                                    .background(Color.accentColor.opacity(0.15))
                                    .clipShape(Capsule())
                            }
                            if !memory.isActive {
                                Text(memory.status == "superseded" ? "replaced" : "forgotten")
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 1)
                                    .background(Color.secondary.opacity(0.15))
                                    .clipShape(Capsule())
                            }

                            Text(memory.createdDate, style: .relative)
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            if !memory.tags.isEmpty {
                                Text(memory.tags.joined(separator: ", "))
                                    .font(.caption)
                                    .foregroundStyle(.blue)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .searchable(text: $memoryVM.searchQuery, prompt: "Search memories")
        .onSubmit(of: .search) {
            Task { await appVM.memoryVM.searchMemories(using: appVM) }
        }
        .onChange(of: appVM.memoryVM.searchQuery) { _, newValue in
            if newValue.isEmpty {
                Task { await appVM.memoryVM.loadMemories(using: appVM) }
            }
        }
        .navigationTitle("Memory")
        .navigationDestination(for: MemoryItem.self) { memory in
            MemoryDetailView(memory: memory)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showNewMemory = true
                } label: {
                    Image(systemName: "plus")
                }
            }
            ToolbarItem(placement: .secondaryAction) {
                Toggle("Show replaced and forgotten", isOn: $memoryVM.showAll)
            }
        }
        .onChange(of: appVM.memoryVM.showAll) { _, _ in
            Task { await appVM.memoryVM.loadMemories(using: appVM) }
        }
        .sheet(isPresented: $showNewMemory) {
            NewMemoryView()
        }
        .refreshable {
            await appVM.memoryVM.loadMemories(using: appVM)
        }
        .task {
            await appVM.memoryVM.loadMemories(using: appVM)
        }
        .overlay {
            if appVM.memoryVM.memories.isEmpty && !appVM.memoryVM.isLoading {
                ContentUnavailableView(
                    "No Memories",
                    systemImage: "brain",
                    description: Text("Memories will appear here as Sam learns")
                )
            }
        }
    }
}
