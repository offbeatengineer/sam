//! Upload a file to the agent's POST /upload and print the result.
//! Usage: cargo run -p sam-client --example upload_smoke -- <file> <http-base-url> [api-key]

use sam_client::SamClient;

fn main() {
    let mut args = std::env::args().skip(1);
    let file = args
        .next()
        .expect("usage: upload_smoke <file> <base-url> [api-key]");
    let base = args
        .next()
        .unwrap_or_else(|| "http://127.0.0.1:9222".into());
    let api_key = args.next();

    let mime = match file.rsplit('.').next() {
        Some("png") => "image/png",
        Some("wav") => "audio/wav",
        _ => "image/jpeg",
    };

    let (client, _events) = SamClient::new();
    let upload = client.upload_file(
        file,
        format!("{base}/upload"),
        api_key,
        mime.to_string(),
        false,
    );
    match futures::executor::block_on(upload) {
        Ok(result) => println!(
            "uploaded: id={} path={} mime={}",
            result.id, result.path, result.mime_type
        ),
        Err(e) => {
            eprintln!("upload failed: {e}");
            std::process::exit(1);
        }
    }
}
