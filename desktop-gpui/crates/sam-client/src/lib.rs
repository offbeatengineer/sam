//! Tokio-based IO layer for the Sam app channel.
//!
//! This crate deliberately has **no gpui dependency**. It owns a tokio runtime
//! on a dedicated thread and exposes a [`SamClient`] handle whose methods are
//! callable synchronously from UI code; results come back through
//! runtime-agnostic `futures` channels that can be awaited on gpui's executor.

mod audio;
mod runtime;
mod upload;
mod ws;

use futures::channel::{mpsc, oneshot};
use sam_protocol::{AppRequest, AppResponse};

pub use audio::RecordingResult;
pub use upload::UploadResult;

/// Events pushed from the IO layer to the UI.
#[derive(Debug)]
pub enum ClientEvent {
    Connected,
    Disconnected,
    Response(AppResponse),
}

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("not connected to sam")]
    NotConnected,
    #[error("request timed out")]
    Timeout,
    #[error("connection lost")]
    ConnectionLost,
    #[error("request has no requestId; use send() instead")]
    NoRequestId,
    #[error("{0}")]
    Other(String),
}

pub(crate) enum Command {
    Connect {
        url: String,
    },
    Disconnect,
    Send(AppRequest),
    Request {
        request: AppRequest,
        reply: oneshot::Sender<Result<AppResponse, ClientError>>,
    },
    StartRecording {
        reply: oneshot::Sender<Result<(), ClientError>>,
    },
    StopRecording {
        reply: oneshot::Sender<Result<RecordingResult, ClientError>>,
    },
    Upload {
        file_path: String,
        upload_url: String,
        api_key: Option<String>,
        mime_type: String,
        /// Delete the local file after a successful upload (used for temp recordings).
        delete_after: bool,
        reply: oneshot::Sender<Result<UploadResult, ClientError>>,
    },
    Fetch {
        url: String,
        api_key: Option<String>,
        reply: oneshot::Sender<Result<Vec<u8>, ClientError>>,
    },
}

/// Handle to the IO actor. Cheap to clone; methods never block.
#[derive(Clone)]
pub struct SamClient {
    cmd_tx: tokio::sync::mpsc::UnboundedSender<Command>,
}

impl SamClient {
    /// Spawns the IO thread. The returned receiver is the single event stream
    /// for the whole app; take it once and pump it on the UI executor.
    pub fn new() -> (Self, mpsc::UnboundedReceiver<ClientEvent>) {
        let (event_tx, event_rx) = mpsc::unbounded();
        let cmd_tx = runtime::spawn(event_tx);
        (Self { cmd_tx }, event_rx)
    }

    /// Connect (and auto-reconnect with backoff until `disconnect`).
    pub fn connect(&self, url: String) {
        let _ = self.cmd_tx.send(Command::Connect { url });
    }

    /// Disconnect and disable auto-reconnect.
    pub fn disconnect(&self) {
        let _ = self.cmd_tx.send(Command::Disconnect);
    }

    /// Fire-and-forget request (chat, abort, …). Streaming responses arrive
    /// as [`ClientEvent::Response`] on the event stream.
    pub fn send(&self, request: AppRequest) {
        let _ = self.cmd_tx.send(Command::Send(request));
    }

    /// Send a request carrying a `requestId` and await the correlated
    /// response (10s timeout). The response is consumed here and will NOT
    /// appear on the event stream.
    pub fn request(
        &self,
        request: AppRequest,
    ) -> impl std::future::Future<Output = Result<AppResponse, ClientError>> + 'static {
        let (reply, rx) = oneshot::channel();
        let sent = self.cmd_tx.send(Command::Request { request, reply });
        async move {
            if sent.is_err() {
                return Err(ClientError::Other("client shut down".into()));
            }
            rx.await
                .unwrap_or(Err(ClientError::Other("client shut down".into())))
        }
    }

    pub fn start_recording(
        &self,
    ) -> impl std::future::Future<Output = Result<(), ClientError>> + 'static {
        let (reply, rx) = oneshot::channel();
        let sent = self.cmd_tx.send(Command::StartRecording { reply });
        async move {
            if sent.is_err() {
                return Err(ClientError::Other("client shut down".into()));
            }
            rx.await
                .unwrap_or(Err(ClientError::Other("client shut down".into())))
        }
    }

    pub fn stop_recording(
        &self,
    ) -> impl std::future::Future<Output = Result<RecordingResult, ClientError>> + 'static {
        let (reply, rx) = oneshot::channel();
        let sent = self.cmd_tx.send(Command::StopRecording { reply });
        async move {
            if sent.is_err() {
                return Err(ClientError::Other("client shut down".into()));
            }
            rx.await
                .unwrap_or(Err(ClientError::Other("client shut down".into())))
        }
    }

    /// GET a resource (artifact, upload) from the agent's HTTP server.
    pub fn fetch_bytes(
        &self,
        url: String,
        api_key: Option<String>,
    ) -> impl std::future::Future<Output = Result<Vec<u8>, ClientError>> + 'static {
        let (reply, rx) = oneshot::channel();
        let sent = self.cmd_tx.send(Command::Fetch {
            url,
            api_key,
            reply,
        });
        async move {
            if sent.is_err() {
                return Err(ClientError::Other("client shut down".into()));
            }
            rx.await
                .unwrap_or(Err(ClientError::Other("client shut down".into())))
        }
    }

    /// Upload a local file to the agent's `POST /upload` endpoint.
    pub fn upload_file(
        &self,
        file_path: String,
        upload_url: String,
        api_key: Option<String>,
        mime_type: String,
        delete_after: bool,
    ) -> impl std::future::Future<Output = Result<UploadResult, ClientError>> + 'static {
        let (reply, rx) = oneshot::channel();
        let sent = self.cmd_tx.send(Command::Upload {
            file_path,
            upload_url,
            api_key,
            mime_type,
            delete_after,
            reply,
        });
        async move {
            if sent.is_err() {
                return Err(ClientError::Other("client shut down".into()));
            }
            rx.await
                .unwrap_or(Err(ClientError::Other("client shut down".into())))
        }
    }
}
