import Foundation

@Observable
final class SkillViewModel {
    var skills: [SkillInfo] = []
    var isLoading = false
    var error: String?

    func loadSkills(using app: AppViewModel) async {
        let requestId = UUID().uuidString
        isLoading = true
        do {
            let response = try await app.request(
                .listSkills(requestId: requestId),
                requestId: requestId
            )
            if case .skillsListResult(_, let items) = response {
                await MainActor.run {
                    self.skills = items
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

    func getSkillContent(filename: String, using app: AppViewModel) async -> String? {
        let requestId = UUID().uuidString
        do {
            let response = try await app.request(
                .getSkill(requestId: requestId, filename: filename),
                requestId: requestId
            )
            if case .skillContentResult(_, _, let content) = response {
                return content
            }
        } catch {
            self.error = error.localizedDescription
        }
        return nil
    }

    func saveSkill(filename: String, content: String, using app: AppViewModel) async -> Bool {
        let requestId = UUID().uuidString
        do {
            let response = try await app.request(
                .saveSkill(requestId: requestId, filename: filename, content: content),
                requestId: requestId
            )
            if case .skillSaveResult(_, let success) = response, success {
                await loadSkills(using: app)
                return true
            }
        } catch {
            self.error = error.localizedDescription
        }
        return false
    }

    func deleteSkill(filename: String, using app: AppViewModel) async -> Bool {
        let requestId = UUID().uuidString
        do {
            let response = try await app.request(
                .deleteSkill(requestId: requestId, filename: filename),
                requestId: requestId
            )
            if case .skillDeleteResult(_, let success) = response, success {
                await loadSkills(using: app)
                return true
            }
        } catch {
            self.error = error.localizedDescription
        }
        return false
    }
}
