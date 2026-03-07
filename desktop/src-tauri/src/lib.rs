use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::Message};

// ---------------------------------------------------------------------------
// Protocol types (mirrors agent/src/protocol.ts)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatAttachment {
    #[serde(rename = "type")]
    attachment_type: String, // "image" or "audio"
    path: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
}

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
        #[serde(skip_serializing_if = "Option::is_none")]
        attachments: Option<Vec<ChatAttachment>>,
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
// Audio recording types
// ---------------------------------------------------------------------------

struct RecordingHandle {
    stop_tx: std::sync::mpsc::Sender<()>,
    join_handle: std::thread::JoinHandle<Result<RecordingResult, String>>,
}

#[derive(Debug, Serialize, Clone)]
struct RecordingResult {
    path: String,
    duration: f64,
    #[serde(rename = "mimeType")]
    mime_type: String,
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
    recording: StdMutex<Option<RecordingHandle>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            ws_sender: Mutex::new(None),
            connected: Mutex::new(false),
            sam_url: Mutex::new(None),
            auto_reconnect: Mutex::new(false),
            connect_lock: Mutex::new(()),
            recording: StdMutex::new(None),
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
    attachments: Option<Vec<ChatAttachment>>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let request = AppRequest::Chat {
        request_id,
        conversation_id,
        text: message,
        attachments,
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
// Audio recording commands
// ---------------------------------------------------------------------------

fn recording_thread(stop_rx: std::sync::mpsc::Receiver<()>) -> Result<RecordingResult, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::SampleFormat;

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No audio input device found")?;
    let supported_config = device
        .default_input_config()
        .map_err(|e| format!("No input config: {e}"))?;

    let sample_rate = supported_config.sample_rate().0;
    let channels = supported_config.channels() as u16;
    let config: cpal::StreamConfig = supported_config.clone().into();

    let samples: Arc<StdMutex<Vec<f32>>> = Arc::new(StdMutex::new(Vec::new()));
    let samples_ref = samples.clone();

    fn err_fn(err: cpal::StreamError) {
        eprintln!("[tauri] Recording stream error: {err}");
    }

    let stream = match supported_config.sample_format() {
        SampleFormat::F32 => {
            let s = samples_ref;
            device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    s.lock().unwrap().extend_from_slice(data);
                },
                err_fn,
                None,
            )
        }
        SampleFormat::I16 => {
            let s = samples_ref;
            device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let floats: Vec<f32> =
                        data.iter().map(|&v| v as f32 / i16::MAX as f32).collect();
                    s.lock().unwrap().extend_from_slice(&floats);
                },
                err_fn,
                None,
            )
        }
        other => return Err(format!("Unsupported sample format: {other:?}")),
    }
    .map_err(|e| format!("Failed to build input stream: {e}"))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start recording: {e}"))?;

    // Block until stop signal
    let _ = stop_rx.recv();
    drop(stream);

    let samples = samples.lock().unwrap();
    let duration = samples.len() as f64 / (sample_rate as f64 * channels as f64);

    // Write WAV to temp file
    let filename = format!(
        "sam_rec_{}.wav",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let path = std::env::temp_dir().join(filename);

    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(&path, spec).map_err(|e| format!("Failed to create WAV: {e}"))?;

    for &sample in samples.iter() {
        let clamped = sample.clamp(-1.0, 1.0);
        writer
            .write_sample((clamped * i16::MAX as f32) as i16)
            .map_err(|e| format!("WAV write error: {e}"))?;
    }
    writer
        .finalize()
        .map_err(|e| format!("WAV finalize error: {e}"))?;

    Ok(RecordingResult {
        path: path.to_string_lossy().to_string(),
        duration,
        mime_type: "audio/wav".to_string(),
    })
}

#[tauri::command]
fn start_recording(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut recording = state.recording.lock().map_err(|e| e.to_string())?;
    if recording.is_some() {
        return Err("Already recording".into());
    }

    let (stop_tx, stop_rx) = std::sync::mpsc::channel();
    let join_handle = std::thread::spawn(move || recording_thread(stop_rx));

    *recording = Some(RecordingHandle {
        stop_tx,
        join_handle,
    });
    println!("[tauri] Recording started");
    Ok(())
}

#[tauri::command]
fn stop_recording(state: State<'_, Arc<AppState>>) -> Result<RecordingResult, String> {
    let handle = {
        let mut recording = state.recording.lock().map_err(|e| e.to_string())?;
        recording.take().ok_or("Not recording")?
    };

    let _ = handle.stop_tx.send(());
    let result = handle
        .join_handle
        .join()
        .map_err(|_| "Recording thread panicked".to_string())?;
    println!("[tauri] Recording stopped");
    result
}

// ---------------------------------------------------------------------------
// File upload (from Rust to bypass CORS)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct UploadResult {
    id: String,
    path: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
}

#[tauri::command]
async fn upload_file(
    file_path: String,
    upload_url: String,
    api_key: Option<String>,
    mime_type: String,
) -> Result<UploadResult, String> {
    let file_data = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;

    let client = reqwest::Client::new();
    let mut request = client
        .post(&upload_url)
        .header("Content-Type", &mime_type)
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

    // Clean up temp file
    let _ = tokio::fs::remove_file(&file_path).await;

    Ok(result)
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
            start_recording,
            stop_recording,
            upload_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
