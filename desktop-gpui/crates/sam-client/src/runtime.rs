//! Owns the tokio runtime on a dedicated thread and runs the connection actor.

use crate::{ws, ClientEvent, Command};
use futures::channel::mpsc::UnboundedSender;

/// Spawn the IO thread; returns the command sender the [`crate::SamClient`]
/// handle wraps. The thread exits when every command sender is dropped.
pub(crate) fn spawn(
    event_tx: UnboundedSender<ClientEvent>,
) -> tokio::sync::mpsc::UnboundedSender<Command> {
    let (cmd_tx, cmd_rx) = tokio::sync::mpsc::unbounded_channel();

    std::thread::Builder::new()
        .name("sam-client-io".into())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
            runtime.block_on(ws::actor_loop(cmd_rx, event_tx));
        })
        .expect("failed to spawn sam-client-io thread");

    cmd_tx
}
