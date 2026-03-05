import SwiftUI

struct KitListView: View {
    @Environment(AppViewModel.self) private var appVM

    var body: some View {
        List {
            ForEach(appVM.kitVM.kits) { kit in
                NavigationLink {
                    KitDetailView(kit: kit)
                } label: {
                    HStack {
                        Image(systemName: "shippingbox")
                            .foregroundStyle(kit.enabled ? .blue : .secondary)
                        VStack(alignment: .leading) {
                            Text(kit.name)
                                .font(.body)
                            Text(kit.description)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        if kit.enabled {
                            Circle()
                                .fill(.green)
                                .frame(width: 8, height: 8)
                        }
                    }
                }
            }
        }
        .navigationTitle("Kits")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await appVM.kitVM.loadKits()
        }
        .refreshable {
            await appVM.kitVM.loadKits()
        }
        .overlay {
            if appVM.kitVM.kits.isEmpty && !appVM.kitVM.isLoading {
                ContentUnavailableView(
                    "No Kits",
                    systemImage: "shippingbox",
                    description: Text("Ask Sam to create a kit for you")
                )
            }
        }
    }
}
