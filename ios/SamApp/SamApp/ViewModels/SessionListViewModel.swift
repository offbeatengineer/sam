import SwiftUI

@Observable
final class SessionListViewModel {
    var sessions: [SessionInfo] = []
    var isLoading = false
    var error: String?

    /// Tracks which channel sections are collapsed.
    var collapsedChannels: Set<String> = ["pulse"]

    /// Sessions grouped by channelId.
    var groupedSessions: [(channelId: String, sessions: [SessionInfo])] {
        let grouped = Dictionary(grouping: sessions, by: \.channelId)
        let order = ["app", "discord", "pulse"]
        return grouped.sorted { a, b in
            let ia = order.firstIndex(of: a.key) ?? Int.max
            let ib = order.firstIndex(of: b.key) ?? Int.max
            if ia != ib { return ia < ib }
            return a.key < b.key
        }.map { (channelId: $0.key, sessions: $0.value) }
    }

    /// Binding for Section(isExpanded:) — inverted because Section uses isExpanded (true = open).
    func bindingForChannel(_ channelId: String) -> Binding<Bool> {
        Binding(
            get: { !self.collapsedChannels.contains(channelId) },
            set: { isExpanded in
                if isExpanded {
                    self.collapsedChannels.remove(channelId)
                } else {
                    self.collapsedChannels.insert(channelId)
                }
            }
        )
    }

    func clearAll() {
        sessions = []
        isLoading = false
        error = nil
    }

    func loadSessions(using app: AppViewModel, maxRetries: Int = 2) async {
        isLoading = true
        error = nil

        for attempt in 0...maxRetries {
            let requestId = UUID().uuidString
            print("[Sessions] Loading sessions (requestId: \(requestId), attempt: \(attempt))...")
            do {
                let response = try await app.request(
                    .listSessions(requestId: requestId),
                    requestId: requestId
                )
                if case .sessionsList(_, let list) = response {
                    print("[Sessions] Loaded \(list.count) sessions")
                    self.sessions = list
                    self.isLoading = false
                    self.error = nil
                    return
                } else {
                    print("[Sessions] Unexpected response: \(response)")
                    self.error = "Unexpected response"
                }
            } catch {
                print("[Sessions] Failed to load (attempt \(attempt)): \(error)")
                self.error = error.localizedDescription
                if attempt < maxRetries {
                    try? await Task.sleep(for: .seconds(1))
                    continue
                }
            }
        }
        self.isLoading = false
    }

    func createSession() -> String {
        UUID().uuidString
    }

    func renameSession(sessionPath: String, name: String, using app: AppViewModel) async -> Bool {
        let requestId = UUID().uuidString
        do {
            let response = try await app.request(
                .renameSession(requestId: requestId, sessionPath: sessionPath, name: name),
                requestId: requestId
            )
            if case .renameSessionResult(_, let success) = response {
                if success {
                    await loadSessions(using: app)
                }
                return success
            }
        } catch {
            self.error = error.localizedDescription
        }
        return false
    }
}
