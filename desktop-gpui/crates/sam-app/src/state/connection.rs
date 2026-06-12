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

    /// Add or update an instance, persist, make it active, and (re)connect.
    pub fn save_and_connect_instance(
        &mut self,
        instance: BackendInstance,
        cx: &mut Context<Self>,
    ) {
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
        self.settings.active_instance_id = Some(instance.id.clone());
        if let Err(e) = self.settings.save() {
            log::error!("failed to save settings: {e}");
        }
        self.client.disconnect();
        self.connect_active(cx);
    }
}
