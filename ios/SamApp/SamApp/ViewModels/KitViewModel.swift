import Foundation

@Observable
final class KitViewModel {
    var kits: [KitInfo] = []
    var isLoading = false
    var error: String?
    var baseURL: URL?

    /// Load kit listing from the kits HTTP server.
    func loadKits() async {
        guard let baseURL else { return }
        isLoading = true
        do {
            let url = baseURL.appendingPathComponent("kits")
            let (data, _) = try await URLSession.shared.data(from: url)
            let decoded = try JSONDecoder().decode([KitInfo].self, from: data)
            await MainActor.run {
                self.kits = decoded
                self.isLoading = false
                self.error = nil
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    func kitURL(for kit: KitInfo) -> URL? {
        baseURL?.appendingPathComponent("kits/\(kit.id)/")
    }
}
