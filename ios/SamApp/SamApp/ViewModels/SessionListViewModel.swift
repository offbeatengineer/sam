import SwiftUI

@Observable
final class SessionListViewModel {
    var sessions: [SessionInfo] = []
    var isLoading = false
    var error: String?

    /// Tracks which channel sections are expanded (all expanded by default).
    var collapsedChannels: Set<String> = []

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

    func loadSessions(using app: AppViewModel) async {
        let requestId = UUID().uuidString
        do {
            isLoading = true
            let response = try await app.request(
                .listSessions(requestId: requestId),
                requestId: requestId
            )
            if case .sessionsList(_, let list) = response {
                await MainActor.run {
                    self.sessions = list
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
