import Foundation

@Observable
final class MemoryViewModel {
    var memories: [MemoryItem] = []
    var total: Int = 0
    var isLoading = false
    var searchQuery: String = ""
    var error: String?

    func loadMemories(using app: AppViewModel) async {
        let requestId = UUID().uuidString
        isLoading = true
        do {
            let response = try await app.request(
                .memoryList(requestId: requestId, limit: 100, offset: 0),
                requestId: requestId
            )
            if case .memoryListResult(_, let items, let total) = response {
                await MainActor.run {
                    self.memories = items
                    self.total = total
                    self.isLoading = false
                    self.error = nil
                }
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    func searchMemories(using app: AppViewModel) async {
        guard !searchQuery.trimmingCharacters(in: .whitespaces).isEmpty else {
            await loadMemories(using: app)
            return
        }
        let requestId = UUID().uuidString
        isLoading = true
        do {
            let response = try await app.request(
                .memorySearch(requestId: requestId, query: searchQuery, limit: 50, tags: nil),
                requestId: requestId
            )
            if case .memorySearchResult(_, let items, _) = response {
                await MainActor.run {
                    self.memories = items
                    self.isLoading = false
                    self.error = nil
                }
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    func saveMemory(text: String, tags: [String], using app: AppViewModel) async -> Bool {
        let requestId = UUID().uuidString
        do {
            let response = try await app.request(
                .memorySave(requestId: requestId, text: text, tags: tags, source: "ios-app"),
                requestId: requestId
            )
            if case .memorySaveResult = response {
                await loadMemories(using: app)
                return true
            }
        } catch {
            self.error = error.localizedDescription
        }
        return false
    }

    func updateMemory(id: String, text: String, tags: [String], using app: AppViewModel) async -> Bool {
        let requestId = UUID().uuidString
        do {
            let response = try await app.request(
                .memoryUpdate(requestId: requestId, id: id, text: text, tags: tags),
                requestId: requestId
            )
            if case .memoryUpdateResult(_, let success) = response, success {
                await loadMemories(using: app)
                return true
            }
        } catch {
            self.error = error.localizedDescription
        }
        return false
    }

    func deleteMemory(id: String, using app: AppViewModel) async -> Bool {
        let requestId = UUID().uuidString
        do {
            let response = try await app.request(
                .memoryDelete(requestId: requestId, id: id),
                requestId: requestId
            )
            if case .memoryDeleteResult(_, let success) = response, success {
                await loadMemories(using: app)
                return true
            }
        } catch {
            self.error = error.localizedDescription
        }
        return false
    }
}
