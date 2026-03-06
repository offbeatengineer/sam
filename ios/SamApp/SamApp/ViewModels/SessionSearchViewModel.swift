import Foundation

@Observable
final class SessionSearchViewModel {
    /// Conversation IDs matching the current search. nil = no active search.
    var matchingIds: Set<String>?
    var isSearching = false
    var searchQuery: String = ""

    func search(using app: AppViewModel) async {
        let query = searchQuery.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else {
            matchingIds = nil
            return
        }

        let requestId = UUID().uuidString
        isSearching = true
        do {
            let response = try await app.request(
                .sessionSearch(requestId: requestId, query: query, limit: 20),
                requestId: requestId
            )
            if case .sessionSearchResult(_, let items, _) = response {
                await MainActor.run {
                    self.matchingIds = Set(items.map(\.conversation_id))
                    self.isSearching = false
                }
            }
        } catch {
            await MainActor.run {
                self.isSearching = false
            }
        }
    }

    func clear() {
        searchQuery = ""
        matchingIds = nil
        isSearching = false
    }
}
