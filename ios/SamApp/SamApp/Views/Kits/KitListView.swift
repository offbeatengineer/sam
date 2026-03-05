import SwiftUI

struct KitListView: View {
    @Environment(AppViewModel.self) private var appVM

    private let columns = [GridItem(.adaptive(minimum: 80), spacing: 16)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 20) {
                ForEach(appVM.kitVM.kits) { kit in
                    NavigationLink {
                        KitDetailView(kit: kit)
                    } label: {
                        VStack(spacing: 8) {
                            Image(systemName: KitInfo.sfSymbol(for: kit.icon))
                                .font(.system(size: 28))
                                .frame(width: 56, height: 56)
                                .background(kit.enabled ? Color.blue.opacity(0.12) : Color.secondary.opacity(0.08))
                                .foregroundStyle(kit.enabled ? .blue : .secondary)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            Text(kit.name)
                                .font(.caption)
                                .foregroundStyle(.primary)
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
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
