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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppResponse {
    #[serde(rename = "type")]
    pub response_type: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: Option<String>,
    #[serde(rename = "requestId")]
    pub request_id: Option<String>,
    // text_delta / thinking_delta
    pub delta: Option<String>,
    #[serde(rename = "contentIndex")]
    pub content_index: Option<u32>,
    // tool fields
    #[serde(rename = "toolCallId")]
    pub tool_call_id: Option<String>,
    #[serde(rename = "toolName")]
    pub tool_name: Option<String>,
    pub args: Option<serde_json::Value>,
    #[serde(rename = "partialResult")]
    pub partial_result: Option<String>,
    pub result: Option<String>,
    #[serde(rename = "isError")]
    pub is_error: Option<bool>,
    // error
    pub error: Option<String>,
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
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            ws_sender: Mutex::new(None),
            connected: Mutex::new(false),
        }
    }
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
    // Disconnect existing connection if any
    {
        let mut sender = state.ws_sender.lock().await;
        if sender.is_some() {
            *sender = None;
        }
        let mut connected = state.connected.lock().await;
        *connected = false;
    }

    let (ws_stream, _) = connect_async(&url)
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

    // Spawn reader task that forwards WS messages as Tauri events
    let app_handle = app.clone();
    let state_clone = state.inner().clone();
    tokio::spawn(async move {
        let mut read = read;
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    match serde_json::from_str::<AppResponse>(&text) {
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
        let mut sender = state_clone.ws_sender.lock().await;
        *sender = None;
        let mut connected = state_clone.connected.lock().await;
        *connected = false;
        println!("[tauri] Disconnected from sam");
    });

    Ok(())
}

#[tauri::command]
async fn disconnect_from_sam(
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
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
    task_id: String,
    message: String,
    request_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let request = AppRequest::Chat {
        request_id,
        conversation_id: task_id,
        text: message,
    };
    send_request(&state, &request).await
}

#[tauri::command]
async fn close_session(
    task_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let request = AppRequest::CloseSession {
        conversation_id: task_id,
    };
    send_request(&state, &request).await
}

#[tauri::command]
async fn abort_turn(
    task_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let request = AppRequest::Abort {
        conversation_id: task_id,
    };
    send_request(&state, &request).await
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
