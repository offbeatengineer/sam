//! Connection actor: owns the WebSocket, reconnect backoff, and the
//! requestId → reply correlation map. Ported from
//! `desktop/src-tauri/src/lib.rs` (establish_connection / spawn_reconnect).

use std::collections::HashMap;
use std::time::Duration;

use futures::channel::{mpsc::UnboundedSender as EventSender, oneshot};
use futures_util::{SinkExt, StreamExt};
use sam_protocol::{AppRequest, AppResponse};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

use crate::{audio, upload, ClientError, ClientEvent, Command};

const INITIAL_BACKOFF: Duration = Duration::from_secs(2);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

type WsSink = futures_util::stream::SplitSink<
    WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
    Message,
>;

enum Internal {
    WsText { generation: u64, text: String },
    WsClosed { generation: u64 },
    ReconnectTick,
    RequestTimeout { request_id: String },
}

pub(crate) async fn actor_loop(
    mut cmd_rx: UnboundedReceiver<Command>,
    event_tx: EventSender<ClientEvent>,
) {
    let (internal_tx, mut internal_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut actor = Actor {
        event_tx,
        internal_tx,
        sink: None,
        generation: 0,
        url: None,
        auto_reconnect: false,
        backoff: INITIAL_BACKOFF,
        reconnect_scheduled: false,
        pending: HashMap::new(),
        recording: None,
    };

    loop {
        tokio::select! {
            cmd = cmd_rx.recv() => match cmd {
                Some(cmd) => actor.handle_command(cmd).await,
                // All SamClient handles dropped — shut down.
                None => break,
            },
            Some(internal) = internal_rx.recv() => actor.handle_internal(internal).await,
        }
    }
}

struct Actor {
    event_tx: EventSender<ClientEvent>,
    internal_tx: UnboundedSender<Internal>,
    sink: Option<WsSink>,
    /// Bumped on every (re)connect and manual disconnect so events from a
    /// stale read task are ignored.
    generation: u64,
    url: Option<String>,
    auto_reconnect: bool,
    backoff: Duration,
    reconnect_scheduled: bool,
    pending: HashMap<String, oneshot::Sender<Result<AppResponse, ClientError>>>,
    recording: Option<audio::RecordingHandle>,
}

impl Actor {
    fn emit(&self, event: ClientEvent) {
        let _ = self.event_tx.unbounded_send(event);
    }

    async fn handle_command(&mut self, cmd: Command) {
        match cmd {
            Command::Connect { url } => {
                self.url = Some(url);
                self.auto_reconnect = true;
                self.backoff = INITIAL_BACKOFF;
                if self.sink.is_some() {
                    self.emit(ClientEvent::Connected);
                    return;
                }
                self.try_connect().await;
            }
            Command::Disconnect => {
                self.auto_reconnect = false;
                self.generation += 1; // invalidate the read task's pending WsClosed
                if let Some(mut sink) = self.sink.take() {
                    let _ = sink.close().await;
                }
                self.fail_pending(|| ClientError::ConnectionLost);
                self.emit(ClientEvent::Disconnected);
            }
            Command::Send(request) => {
                if let Err(error) = self.send_request(&request).await {
                    log::warn!("send failed: {error}");
                    // Surface as a protocol-shaped error so the UI's single
                    // error path handles it (e.g. a chat that didn't go out).
                    self.emit(ClientEvent::Response(AppResponse::Error {
                        conversation_id: conversation_id_of(&request),
                        error,
                    }));
                }
            }
            Command::Request { request, reply } => {
                let Some(request_id) = request.request_id().map(str::to_owned) else {
                    let _ = reply.send(Err(ClientError::NoRequestId));
                    return;
                };
                if self.sink.is_none() {
                    let _ = reply.send(Err(ClientError::NotConnected));
                    return;
                }
                if let Err(error) = self.send_request(&request).await {
                    let _ = reply.send(Err(ClientError::Other(error)));
                    return;
                }
                self.pending.insert(request_id.clone(), reply);
                let internal_tx = self.internal_tx.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(REQUEST_TIMEOUT).await;
                    let _ = internal_tx.send(Internal::RequestTimeout { request_id });
                });
            }
            Command::StartRecording { reply } => {
                if self.recording.is_some() {
                    let _ = reply.send(Err(ClientError::Other("already recording".into())));
                    return;
                }
                self.recording = Some(audio::start());
                let _ = reply.send(Ok(()));
            }
            Command::StopRecording { reply } => {
                let Some(handle) = self.recording.take() else {
                    let _ = reply.send(Err(ClientError::Other("not recording".into())));
                    return;
                };
                // Joining the recording thread blocks while the WAV is
                // finalized; keep it off the actor.
                tokio::spawn(async move {
                    let result = tokio::task::spawn_blocking(move || handle.stop())
                        .await
                        .unwrap_or_else(|_| Err("recording thread panicked".into()));
                    let _ = reply.send(result.map_err(ClientError::Other));
                });
            }
            Command::Upload {
                file_path,
                upload_url,
                api_key,
                mime_type,
                delete_after,
                reply,
            } => {
                tokio::spawn(async move {
                    let result = upload::upload_file(
                        &file_path,
                        &upload_url,
                        api_key,
                        &mime_type,
                        delete_after,
                    )
                    .await
                    .map_err(ClientError::Other);
                    let _ = reply.send(result);
                });
            }
            Command::Fetch {
                url,
                api_key,
                reply,
            } => {
                tokio::spawn(async move {
                    let result = upload::fetch_bytes(&url, api_key)
                        .await
                        .map_err(ClientError::Other);
                    let _ = reply.send(result);
                });
            }
        }
    }

    async fn handle_internal(&mut self, internal: Internal) {
        match internal {
            Internal::WsText { generation, text } => {
                if generation != self.generation {
                    return;
                }
                match serde_json::from_str::<AppResponse>(&text) {
                    Ok(response) => {
                        // Correlated responses resolve their pending request and
                        // are consumed; everything else is broadcast to the UI.
                        if let Some(reply) =
                            response.request_id().and_then(|id| self.pending.remove(id))
                        {
                            let _ = reply.send(Ok(response));
                        } else {
                            self.emit(ClientEvent::Response(response));
                        }
                    }
                    Err(e) => log::warn!("failed to parse sam response: {e}: {text}"),
                }
            }
            Internal::WsClosed { generation } => {
                if generation != self.generation {
                    return;
                }
                self.sink = None;
                self.fail_pending(|| ClientError::ConnectionLost);
                self.emit(ClientEvent::Disconnected);
                if self.auto_reconnect {
                    self.schedule_reconnect();
                }
            }
            Internal::ReconnectTick => {
                self.reconnect_scheduled = false;
                if self.sink.is_none() && self.auto_reconnect {
                    self.try_connect().await;
                }
            }
            Internal::RequestTimeout { request_id } => {
                if let Some(reply) = self.pending.remove(&request_id) {
                    let _ = reply.send(Err(ClientError::Timeout));
                }
            }
        }
    }

    async fn send_request(&mut self, request: &AppRequest) -> Result<(), String> {
        let json = serde_json::to_string(request).map_err(|e| e.to_string())?;
        let Some(sink) = self.sink.as_mut() else {
            return Err("not connected to sam".into());
        };
        sink.send(Message::Text(json))
            .await
            .map_err(|e| format!("failed to send to sam: {e}"))
    }

    async fn try_connect(&mut self) {
        let Some(url) = self.url.clone() else { return };
        match connect_async(&normalize_url(&url)).await {
            Ok((ws_stream, _)) => {
                let (write, mut read) = ws_stream.split();
                self.generation += 1;
                self.sink = Some(write);
                self.backoff = INITIAL_BACKOFF;
                log::info!("connected to sam at {url}");
                self.emit(ClientEvent::Connected);

                let generation = self.generation;
                let internal_tx = self.internal_tx.clone();
                tokio::spawn(async move {
                    while let Some(msg) = read.next().await {
                        match msg {
                            Ok(Message::Text(text)) => {
                                let _ = internal_tx.send(Internal::WsText { generation, text });
                            }
                            Ok(Message::Close(_)) | Err(_) => break,
                            _ => {}
                        }
                    }
                    let _ = internal_tx.send(Internal::WsClosed { generation });
                });
            }
            Err(e) => {
                log::warn!("failed to connect to sam at {url}: {e}");
                self.emit(ClientEvent::Disconnected);
                if self.auto_reconnect {
                    self.schedule_reconnect();
                }
            }
        }
    }

    fn schedule_reconnect(&mut self) {
        if self.reconnect_scheduled {
            return;
        }
        self.reconnect_scheduled = true;
        let delay = self.backoff;
        self.backoff = (self.backoff * 2).min(MAX_BACKOFF);
        log::info!("reconnecting in {delay:?}");
        let internal_tx = self.internal_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            let _ = internal_tx.send(Internal::ReconnectTick);
        });
    }

    fn fail_pending(&mut self, error: impl Fn() -> ClientError) {
        for (_, reply) in self.pending.drain() {
            let _ = reply.send(Err(error()));
        }
    }
}

/// Ensure the URL has a path ("/") before query params so tungstenite sends
/// `GET /?... HTTP/1.1` instead of `GET ?...` (which the server 400s).
fn normalize_url(url: &str) -> String {
    if let Some(idx) = url.find('?') {
        let before_q = &url[..idx];
        if before_q.ends_with('/') {
            url.to_string()
        } else {
            format!("{}/{}", before_q, &url[idx..])
        }
    } else {
        url.to_string()
    }
}

fn conversation_id_of(request: &AppRequest) -> Option<String> {
    match request {
        AppRequest::Chat {
            conversation_id, ..
        }
        | AppRequest::Abort { conversation_id }
        | AppRequest::CloseSession { conversation_id } => Some(conversation_id.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_url;

    #[test]
    fn normalizes_query_without_path() {
        assert_eq!(
            normalize_url("ws://127.0.0.1:9222?apiKey=x"),
            "ws://127.0.0.1:9222/?apiKey=x"
        );
        assert_eq!(
            normalize_url("ws://127.0.0.1:9222/?apiKey=x"),
            "ws://127.0.0.1:9222/?apiKey=x"
        );
        assert_eq!(normalize_url("ws://127.0.0.1:9222"), "ws://127.0.0.1:9222");
    }
}
