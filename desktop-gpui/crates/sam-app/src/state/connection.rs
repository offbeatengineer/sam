//! Connection + instance state (replaces the Tauri client's `settingsStore`).
//! Status changes are pushed from the IO layer; there is no polling.

use gpui::Context;
use sam_client::SamClient;

use crate::settings::{AppSettings, BackendInstance};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
}

pub struct ConnectionState {
    pub client: SamClient,
    pub settings: AppSettings,
    pub status: ConnectionStatus,
}

impl ConnectionState {
    pub fn new(client: SamClient) -> Self {
        Self {
            client,
            settings: AppSettings::load(),
            status: ConnectionStatus::Disconnected,
        }
    }

    pub fn active_instance(&self) -> Option<&BackendInstance> {
        self.settings.active_instance()
    }

    /// HTTP base URL of the active instance (uploads, artifacts).
    pub fn artifacts_url(&self) -> Option<String> {
        Some(self.active_instance()?.artifacts_url())
    }

    /// Full URL for an upload/artifact path on the agent's HTTP server,
    /// apiKey in the query (port of `buildUploadUrl`).
    pub fn upload_url(&self, path: &str) -> Option<String> {
        let base = self.artifacts_url()?;
        let sep = if path.starts_with('/') { "" } else { "/" };
        let mut url = format!("{base}{sep}{path}");
        if let Some(key) = self.active_instance().and_then(|i| i.api_key.clone()) {
            let q = if url.contains('?') { '&' } else { '?' };
            url.push(q);
            url.push_str(&format!("apiKey={key}"));
        }
        Some(url)
    }

    pub fn connect_active(&mut self, cx: &mut Context<Self>) {
        if let Some(url) = self.active_instance().map(|i| i.connection_url()) {
            self.status = ConnectionStatus::Connecting;
            self.client.connect(url);
            cx.notify();
        }
    }

    pub fn set_status(&mut self, status: ConnectionStatus, cx: &mut Context<Self>) {
        if self.status != status {
            self.status = status;
            cx.notify();
        }
    }

    /// Add or update an instance and persist. The first instance ever added
    /// becomes active; reconnects when the active instance's connection
    /// details changed (port of `addInstance`/`updateInstance` in
    /// `desktop/src/stores/settingsStore.ts`).
    pub fn save_instance(&mut self, instance: BackendInstance, cx: &mut Context<Self>) {
        let is_first = self.settings.instances.is_empty();
        let old_url = self.active_instance().map(|i| i.connection_url());
        if let Some(existing) = self
            .settings
            .instances
            .iter_mut()
            .find(|i| i.id == instance.id)
        {
            *existing = instance.clone();
        } else {
            self.settings.instances.push(instance.clone());
        }
        if is_first {
            self.settings.active_instance_id = Some(instance.id.clone());
        }
        self.persist();
        let new_url = self.active_instance().map(|i| i.connection_url());
        if old_url != new_url {
            self.client.disconnect();
            self.connect_active(cx);
        }
        cx.notify();
    }

    /// Make another instance active: disconnect, persist, reconnect.
    /// Returns false if the id is unknown or already active. The caller
    /// clears per-instance stores (sessions) — port of `switchInstance`.
    pub fn switch_instance(&mut self, id: &str, cx: &mut Context<Self>) -> bool {
        if self.settings.active_instance_id.as_deref() == Some(id)
            || !self.settings.instances.iter().any(|i| i.id == id)
        {
            return false;
        }
        self.client.disconnect();
        self.settings.active_instance_id = Some(id.to_string());
        self.persist();
        self.status = ConnectionStatus::Disconnected;
        self.connect_active(cx);
        true
    }

    /// Remove an instance. Removing the active one switches to the first
    /// remaining (or disconnects entirely). Returns true if the active
    /// connection changed — caller clears per-instance stores then.
    pub fn remove_instance(&mut self, id: &str, cx: &mut Context<Self>) -> bool {
        let was_active = self.settings.active_instance_id.as_deref() == Some(id);
        self.settings.instances.retain(|i| i.id != id);
        if was_active {
            self.settings.active_instance_id =
                self.settings.instances.first().map(|i| i.id.clone());
        }
        self.persist();
        if was_active {
            self.client.disconnect();
            self.status = ConnectionStatus::Disconnected;
            self.connect_active(cx);
        }
        cx.notify();
        was_active
    }

    fn persist(&self) {
        if let Err(e) = self.settings.save() {
            log::error!("failed to save settings: {e}");
        }
    }
}
