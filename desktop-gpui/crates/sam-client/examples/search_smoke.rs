//! Headless smoke test for the session-search + archived-list protocol ops
//! (the wire paths behind the sidebar search box and archived group).
//! Usage: cargo run -p sam-client --example search_smoke -- "ws://127.0.0.1:9223?apiKey=..." [query]

use futures::StreamExt;
use sam_client::{ClientEvent, SamClient};
use sam_protocol::{AppRequest, AppResponse};

fn main() {
    env_logger::init();
    let url = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "ws://127.0.0.1:9222".to_string());
    let query = std::env::args().nth(2).unwrap_or_else(|| "test".to_string());

    let (client, mut events) = SamClient::new();
    client.connect(url);

    futures::executor::block_on(async move {
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

        // session_search
        let response = client
            .request(AppRequest::SessionSearch {
                request_id: "search-1".into(),
                query: query.clone(),
                limit: Some(20),
            })
            .await
            .expect("session_search failed");
        match response {
            AppResponse::SessionSearchResult { results, count, .. } => {
                println!("session_search '{query}': count={count}, results={}", results.len());
                for r in results.iter().take(5) {
                    println!(
                        "  [{}] {} (score {:.3}) conv={}",
                        r.channel_id, r.session_name, r.score, r.conversation_id
                    );
                }
            }
            other => panic!("unexpected session_search response: {other:?}"),
        }

        // list_archived_sessions
        let response = client
            .request(AppRequest::ListArchivedSessions {
                request_id: "archived-1".into(),
            })
            .await
            .expect("list_archived_sessions failed");
        match response {
            AppResponse::ArchivedSessionsList { sessions, .. } => {
                println!("archived sessions: {}", sessions.len());
                for s in sessions.iter().take(5) {
                    println!(
                        "  [{}] {} ({} msgs)",
                        s.channel_id,
                        s.name.as_deref().unwrap_or(&s.first_message),
                        s.message_count
                    );
                }
            }
            other => panic!("unexpected archived list response: {other:?}"),
        }

        client.disconnect();
        println!("search_smoke OK");
    });
}
