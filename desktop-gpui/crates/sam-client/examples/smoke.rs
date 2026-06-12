//! Headless smoke test against a running agent: connect, list sessions,
//! load one session's entries, disconnect.
//! Usage: cargo run -p sam-client --example smoke -- "ws://127.0.0.1:9223?apiKey=..."

use futures::StreamExt;
use sam_client::{ClientEvent, SamClient};
use sam_protocol::{session::parse_entry, AppRequest, AppResponse};

fn main() {
    env_logger::init();
    let url = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "ws://127.0.0.1:9222".to_string());

    let (client, mut events) = SamClient::new();
    client.connect(url);

    futures::executor::block_on(async move {
        // Wait for connect.
        loop {
            match events.next().await {
                Some(ClientEvent::Connected) => break,
                Some(ClientEvent::Disconnected) => {
                    eprintln!("connect failed (agent running?)");
                    std::process::exit(1);
                }
                Some(other) => println!("event: {other:?}"),
                None => std::process::exit(1),
            }
        }
        println!("connected");

        let response = client
            .request(AppRequest::ListSessions {
                request_id: "smoke-1".into(),
            })
            .await
            .expect("list_sessions failed");
        let AppResponse::SessionsList { sessions, .. } = response else {
            panic!("unexpected response: {response:?}");
        };
        println!("sessions: {}", sessions.len());
        for s in sessions.iter().take(5) {
            println!(
                "  [{}] {} ({} msgs)",
                s.channel_id,
                s.name.as_deref().unwrap_or(&s.first_message),
                s.message_count
            );
        }

        if let Some(first) = sessions.first() {
            let response = client
                .request(AppRequest::GetSessionEntries {
                    request_id: "smoke-2".into(),
                    session_path: first.path.clone(),
                })
                .await
                .expect("get_session_entries failed");
            let AppResponse::SessionEntries { entries, .. } = response else {
                panic!("unexpected response: {response:?}");
            };
            let parsed: Vec<_> = entries.into_iter().map(parse_entry).collect();
            let unknown = parsed
                .iter()
                .filter(|e| matches!(e, sam_protocol::session::SessionEntry::Unknown { .. }))
                .count();
            println!(
                "entries in first session: {} ({} unknown)",
                parsed.len(),
                unknown
            );
        }

        client.disconnect();
        println!("smoke OK");
    });
}
