use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::Message};

// ---------------------------------------------------------------------------
// Protocol types (mirrors agent/src/protocol.ts)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum AppRequest {
    #[serde(rename = "chat")]
    Chat {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "conversationId")]
        conversation_id: String,
        text: String,
    },
    #[serde(rename = "abort")]
    Abort {
        #[serde(rename = "conversationId")]
        conversation_id: String,
    },
    #[serde(rename = "close_session")]
    CloseSession {
        #[serde(rename = "conversationId")]
        conversation_id: String,
    },
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

type WsSender = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    Message,
>;

pub struct AppState {
    ws_sender: Mutex<Option<WsSender>>,
    connected: Mutex<bool>,
    sam_url: Mutex<Option<String>>,
    auto_reconnect: Mutex<bool>,
    connect_lock: Mutex<()>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            ws_sender: Mutex::new(None),
            connected: Mutex::new(false),
            sam_url: Mutex::new(None),
            auto_reconnect: Mutex::new(false),
            connect_lock: Mutex::new(()),
        }
    }
}

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

async fn establish_connection(
    url: &str,
    app: &AppHandle,
    state: &Arc<AppState>,
) -> Result<(), String> {
    let _guard = state.connect_lock.lock().await;

    // Already connected — nothing to do
    if *state.connected.lock().await {
        return Ok(());
    }

    // Normalize URL: ensure path "/" before query params so tungstenite
    // sends "GET /?... HTTP/1.1" instead of "GET ?... HTTP/1.1" (400 Bad Request).
    let normalized = if let Some(idx) = url.find('?') {
        let before_q = &url[..idx];
        if before_q.ends_with('/') {
            url.to_string()
        } else {
            format!("{}/{}", before_q, &url[idx..])
        }
    } else {
        url.to_string()
    };

    let (ws_stream, _) = connect_async(&normalized)
        .await
        .map_err(|e| format!("Failed to connect to sam at {}: {}", url, e))?;

    let (write, read) = ws_stream.split();

    {
        let mut sender = state.ws_sender.lock().await;
        *sender = Some(write);
        let mut connected = state.connected.lock().await;
        *connected = true;
    }

    println!("[tauri] Connected to sam at {}", url);

    let app_handle = app.clone();
    let state_clone = state.clone();
    tokio::spawn(async move {
        let mut read = read;
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    match serde_json::from_str::<serde_json::Value>(&text) {
                        Ok(response) => {
                            let _ = app_handle.emit("app-response", &response);
                        }
                        Err(e) => {
                            eprintln!("[tauri] Failed to parse sam response: {}", e);
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    println!("[tauri] Sam WebSocket closed");
                    break;
                }
                Err(e) => {
                    eprintln!("[tauri] WebSocket error: {}", e);
                    break;
                }
                _ => {}
            }
        }

        // Mark disconnected
        {
            let mut sender = state_clone.ws_sender.lock().await;
            *sender = None;
            let mut connected = state_clone.connected.lock().await;
            *connected = false;
        }
        println!("[tauri] Disconnected from sam");
        let _ = app_handle.emit("app-response", &serde_json::json!({
            "type": "connection_lost"
        }));

        // Auto-reconnect if enabled
        let should_reconnect = *state_clone.auto_reconnect.lock().await;
        let url = state_clone.sam_url.lock().await.clone();
        if should_reconnect {
            if let Some(url) = url {
                spawn_reconnect(url, app_handle, state_clone);
            }
        }
    });

    Ok(())
}

fn spawn_reconnect(url: String, app: AppHandle, state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut delay = std::time::Duration::from_secs(2);
        let max_delay = std::time::Duration::from_secs(30);

        loop {
            if !*state.auto_reconnect.lock().await {
                break;
            }

            println!("[tauri] Reconnecting in {:?}...", delay);
            tokio::time::sleep(delay).await;

            if !*state.auto_reconnect.lock().await {
                break;
            }

            match establish_connection(&url, &app, &state).await {
                Ok(()) => {
                    println!("[tauri] Reconnected to sam");
                    break;
                }
                Err(e) => {
                    eprintln!("[tauri] Reconnect failed: {}", e);
                    delay = (delay * 2).min(max_delay);
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// IPC commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn connect_to_sam(
    url: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    {
        let mut sam_url = state.sam_url.lock().await;
        *sam_url = Some(url.clone());
        let mut auto_reconnect = state.auto_reconnect.lock().await;
        *auto_reconnect = true;
    }

    establish_connection(&url, &app, state.inner()).await
}

#[tauri::command]
async fn disconnect_from_sam(
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    // Disable auto-reconnect before closing
    {
        let mut auto_reconnect = state.auto_reconnect.lock().await;
        *auto_reconnect = false;
    }

    let mut sender = state.ws_sender.lock().await;
    if let Some(ref mut ws) = *sender {
        let _ = ws.close().await;
    }
    *sender = None;
    let mut connected = state.connected.lock().await;
    *connected = false;
    Ok(())
}

#[tauri::command]
async fn is_connected(
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let connected = state.connected.lock().await;
    Ok(*connected)
}

#[tauri::command]
async fn send_chat(
    conversation_id: String,
    message: String,
    request_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let request = AppRequest::Chat {
        request_id,
        conversation_id,
        text: message,
    };
    send_request(&state, &request).await
}

#[tauri::command]
async fn close_session(
    conversation_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let request = AppRequest::CloseSession {
        conversation_id,
    };
    send_request(&state, &request).await
}

#[tauri::command]
async fn abort_turn(
    conversation_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let request = AppRequest::Abort {
        conversation_id,
    };
    send_request(&state, &request).await
}

#[tauri::command]
async fn send_raw(
    request: serde_json::Value,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let json = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    let mut sender = state.ws_sender.lock().await;
    if let Some(ref mut ws) = *sender {
        ws.send(Message::Text(json))
            .await
            .map_err(|e| format!("Failed to send to sam: {}", e))?;
        Ok(())
    } else {
        Err("Not connected to sam".into())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn send_request(state: &State<'_, Arc<AppState>>, request: &AppRequest) -> Result<(), String> {
    let json = serde_json::to_string(request).map_err(|e| e.to_string())?;
    let mut sender = state.ws_sender.lock().await;
    if let Some(ref mut ws) = *sender {
        ws.send(Message::Text(json))
            .await
            .map_err(|e| format!("Failed to send to sam: {}", e))?;
        Ok(())
    } else {
        Err("Not connected to sam".into())
    }
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .setup(|app| {
            app.manage(Arc::new(AppState::default()));
            println!("[tauri] App started — connect to sam via WebSocket");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_to_sam,
            disconnect_from_sam,
            is_connected,
            send_chat,
            close_session,
            abort_turn,
            send_raw,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
