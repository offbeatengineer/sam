//! App settings, persisted to `~/.sam/settings.json` with the exact same
//! schema as the Tauri client (`desktop/src/lib/storage.ts`), including the
//! legacy `{ samUrl }` migration — both clients stay interchangeable.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const DEFAULT_SAM_URL: &str = "ws://127.0.0.1:9222";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackendInstance {
    pub id: String,
    pub name: String,
    pub server_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

impl BackendInstance {
    pub fn new(name: impl Into<String>, server_url: impl Into<String>, api_key: Option<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            server_url: server_url.into(),
            api_key: api_key.filter(|k| !k.is_empty()),
        }
    }

    /// WebSocket URL including the apiKey query param (port of
    /// `buildConnectionUrl` in `desktop/src/types/instance.ts`).
    pub fn connection_url(&self) -> String {
        match &self.api_key {
            Some(key) => {
                let sep = if self.server_url.contains('?') { "&" } else { "?" };
                format!("{}{}apiKey={}", self.server_url, sep, key)
            }
            None => self.server_url.clone(),
        }
    }

    /// HTTP base URL of the same server (port of `deriveArtifactsUrl`).
    pub fn artifacts_url(&self) -> String {
        let (scheme, rest) = match self.server_url.split_once("://") {
            Some(("wss", rest)) | Some(("https", rest)) => ("https", rest),
            Some((_, rest)) => ("http", rest),
            None => return "http://127.0.0.1:9222".into(),
        };
        let host = rest
            .split(['/', '?'])
            .next()
            .filter(|h| !h.is_empty())
            .unwrap_or("127.0.0.1:9222");
        format!("{scheme}://{host}")
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub instances: Vec<BackendInstance>,
    #[serde(default)]
    pub active_instance_id: Option<String>,
}

#[derive(Deserialize)]
struct LegacySettings {
    #[serde(rename = "samUrl")]
    sam_url: Option<String>,
}

fn settings_path() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".sam").join("settings.json"))
}

impl AppSettings {
    pub fn active_instance(&self) -> Option<&BackendInstance> {
        let id = self.active_instance_id.as_ref()?;
        self.instances.iter().find(|i| &i.id == id)
    }

    pub fn load() -> Self {
        let Some(path) = settings_path() else {
            return Self::default();
        };
        let Ok(content) = std::fs::read_to_string(&path) else {
            return Self::default();
        };
        if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
            if !settings.instances.is_empty() || settings.active_instance_id.is_some() {
                return settings;
            }
        }
        // Legacy migration: { "samUrl": "ws://..." }
        if let Ok(LegacySettings { sam_url: Some(url) }) =
            serde_json::from_str::<LegacySettings>(&content)
        {
            let instance = BackendInstance::new("Default", url, None);
            let migrated = AppSettings {
                active_instance_id: Some(instance.id.clone()),
                instances: vec![instance],
            };
            let _ = migrated.save();
            return migrated;
        }
        Self::default()
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let path = settings_path().ok_or_else(|| anyhow::anyhow!("no home directory"))?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_url_appends_api_key() {
        let mut inst = BackendInstance::new("x", "ws://127.0.0.1:9222", Some("secret".into()));
        assert_eq!(inst.connection_url(), "ws://127.0.0.1:9222?apiKey=secret");
        inst.api_key = None;
        assert_eq!(inst.connection_url(), "ws://127.0.0.1:9222");
    }

    #[test]
    fn artifacts_url_derivation() {
        let inst = BackendInstance::new("x", "ws://127.0.0.1:9222", None);
        assert_eq!(inst.artifacts_url(), "http://127.0.0.1:9222");
        let inst = BackendInstance::new("x", "wss://sam.example.com:9222/path?x=1", None);
        assert_eq!(inst.artifacts_url(), "https://sam.example.com:9222");
    }

    #[test]
    fn settings_schema_matches_tauri_client() {
        let json = r#"{
            "instances": [{"id": "a", "name": "Default", "serverUrl": "ws://127.0.0.1:9222", "apiKey": "k"}],
            "activeInstanceId": "a"
        }"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.active_instance().unwrap().server_url, "ws://127.0.0.1:9222");
        let out = serde_json::to_value(&settings).unwrap();
        assert_eq!(out["instances"][0]["serverUrl"], "ws://127.0.0.1:9222");
        assert_eq!(out["activeInstanceId"], "a");
    }
}
