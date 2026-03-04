import Foundation

@Observable
final class SettingsViewModel {
    private static let instancesKey = "sam_backend_instances"
    private static let activeInstanceKey = "sam_active_instance_id"
    // Legacy keys for migration
    private static let legacyURLKey = "sam_server_url"
    private static let legacyAPIKeyKey = "sam_api_key"

    var instances: [BackendInstance] {
        didSet { persistInstances() }
    }

    var activeInstanceId: UUID? {
        didSet { UserDefaults.standard.set(activeInstanceId?.uuidString, forKey: Self.activeInstanceKey) }
    }

    var activeInstance: BackendInstance? {
        guard let id = activeInstanceId else { return nil }
        return instances.first { $0.id == id }
    }

    var serverURL: URL? { activeInstance?.serverURL }
    var apiKey: String? { activeInstance.flatMap { apiKey(for: $0.id) } }
    var artifactsURL: URL? { activeInstance?.artifactsURL }

    // MARK: - Init

    init() {
        // Try loading saved instances
        if let data = UserDefaults.standard.data(forKey: Self.instancesKey),
           let saved = try? JSONDecoder().decode([BackendInstance].self, from: data) {
            self.instances = saved
            if let idStr = UserDefaults.standard.string(forKey: Self.activeInstanceKey) {
                self.activeInstanceId = UUID(uuidString: idStr)
            } else {
                self.activeInstanceId = saved.first?.id
            }
        } else {
            // Migrate from legacy single-server config
            self.instances = []
            self.activeInstanceId = nil
            migrateFromLegacy()
        }
    }

    // MARK: - Instance management

    func addInstance(name: String, serverURLString: String, apiKey: String?) -> BackendInstance {
        let instance = BackendInstance(name: name, serverURLString: serverURLString)
        instances.append(instance)
        if let key = apiKey, !key.isEmpty {
            setApiKey(key, for: instance.id)
        }
        // Auto-activate if this is the only instance
        if instances.count == 1 {
            activeInstanceId = instance.id
        }
        return instance
    }

    func removeInstance(_ id: UUID) {
        instances.removeAll { $0.id == id }
        KeychainHelper.delete(key: keychainKey(for: id))
        if activeInstanceId == id {
            activeInstanceId = instances.first?.id
        }
    }

    func updateInstance(_ updated: BackendInstance) {
        guard let idx = instances.firstIndex(where: { $0.id == updated.id }) else { return }
        instances[idx] = updated
    }

    func setActive(_ id: UUID) {
        activeInstanceId = id
    }

    // MARK: - API Key helpers

    func apiKey(for instanceId: UUID) -> String? {
        KeychainHelper.load(key: keychainKey(for: instanceId))
    }

    func setApiKey(_ key: String?, for instanceId: UUID) {
        if let key, !key.isEmpty {
            KeychainHelper.save(key: keychainKey(for: instanceId), value: key)
        } else {
            KeychainHelper.delete(key: keychainKey(for: instanceId))
        }
    }

    // MARK: - Private

    private func keychainKey(for instanceId: UUID) -> String {
        "sam_api_key_\(instanceId.uuidString)"
    }

    private func persistInstances() {
        if let data = try? JSONEncoder().encode(instances) {
            UserDefaults.standard.set(data, forKey: Self.instancesKey)
        }
    }

    private func migrateFromLegacy() {
        let legacyURL = UserDefaults.standard.string(forKey: Self.legacyURLKey) ?? ""
        guard !legacyURL.isEmpty else { return }

        let legacyKey = KeychainHelper.load(key: Self.legacyAPIKeyKey)
        let instance = addInstance(name: "Default", serverURLString: legacyURL, apiKey: legacyKey)
        activeInstanceId = instance.id

        // Clean up legacy keys
        UserDefaults.standard.removeObject(forKey: Self.legacyURLKey)
        KeychainHelper.delete(key: Self.legacyAPIKeyKey)
    }
}
