//! HTTP upload/download against the agent's `/upload` + `/uploads/{path}`
//! endpoints. Ported from `upload_file` in `desktop/src-tauri/src/lib.rs`.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct UploadResult {
    pub id: String,
    pub path: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

pub(crate) async fn upload_file(
    file_path: &str,
    upload_url: &str,
    api_key: Option<String>,
    mime_type: &str,
    delete_after: bool,
) -> Result<UploadResult, String> {
    let file_data = tokio::fs::read(file_path)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;

    let client = reqwest::Client::new();
    let mut request = client
        .post(upload_url)
        .header("Content-Type", mime_type)
        .body(file_data);

    if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Upload failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Upload failed: {status} {body}"));
    }

    let result: UploadResult = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse upload response: {e}"))?;

    if delete_after {
        let _ = tokio::fs::remove_file(file_path).await;
    }

    Ok(result)
}

/// GET a resource from the agent's HTTP server (artifacts, uploads).
pub(crate) async fn fetch_bytes(url: &str, api_key: Option<String>) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::new();
    let mut request = client.get(url);
    if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(|e| format!("fetch failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("fetch failed: {}", response.status()));
    }
    response
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("fetch failed: {e}"))
}
