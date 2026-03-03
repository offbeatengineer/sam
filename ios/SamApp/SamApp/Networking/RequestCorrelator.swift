import Foundation

/// Maps request IDs to continuations for request-response correlation.
actor RequestCorrelator {
    private var pending: [String: CheckedContinuation<ServerMessage, Error>] = [:]
    private var timeoutTasks: [String: Task<Void, Never>] = [:]

    private static let timeoutSeconds: TimeInterval = 10

    /// Register a pending request. Returns when a matching response arrives or times out.
    func waitForResponse(requestId: String) async throws -> ServerMessage {
        try await withCheckedThrowingContinuation { continuation in
            pending[requestId] = continuation

            let task = Task { [weak self] in
                try? await Task.sleep(for: .seconds(Self.timeoutSeconds))
                await self?.timeout(requestId: requestId)
            }
            timeoutTasks[requestId] = task
        }
    }

    /// Deliver a server message to the matching pending request.
    /// Returns true if the message was consumed by a pending request.
    func deliver(_ message: ServerMessage) -> Bool {
        let requestId: String?
        switch message {
        case .sessionsList(let rid, _),
             .sessionEntries(let rid, _, _),
             .memoryListResult(let rid, _, _),
             .memorySearchResult(let rid, _, _),
             .memorySaveResult(let rid, _, _, _),
             .memoryUpdateResult(let rid, _),
             .memoryDeleteResult(let rid, _),
             .memoryError(let rid, _),
             .renameSessionResult(let rid, _),
             .skillsListResult(let rid, _),
             .skillContentResult(let rid, _, _),
             .skillSaveResult(let rid, _),
             .skillDeleteResult(let rid, _),
             .skillError(let rid, _):
            requestId = rid
        default:
            requestId = nil
        }

        guard let rid = requestId, let continuation = pending.removeValue(forKey: rid) else {
            return false
        }

        timeoutTasks.removeValue(forKey: rid)?.cancel()
        continuation.resume(returning: message)
        return true
    }

    private func timeout(requestId: String) {
        guard let continuation = pending.removeValue(forKey: requestId) else { return }
        timeoutTasks.removeValue(forKey: requestId)
        continuation.resume(throwing: CorrelatorError.timeout)
    }

    func cancelAll() {
        for (_, continuation) in pending {
            continuation.resume(throwing: CancellationError())
        }
        pending.removeAll()
        for (_, task) in timeoutTasks { task.cancel() }
        timeoutTasks.removeAll()
    }
}

enum CorrelatorError: Error, LocalizedError {
    case timeout

    var errorDescription: String? {
        switch self {
        case .timeout: return "Request timed out"
        }
    }
}
