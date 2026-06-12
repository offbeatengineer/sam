//! Microphone recording via cpal → WAV via hound. Direct port of the
//! recording code in `desktop/src-tauri/src/lib.rs`.

use std::sync::{Arc, Mutex};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct RecordingResult {
    pub path: String,
    /// Seconds.
    pub duration: f64,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

pub(crate) struct RecordingHandle {
    stop_tx: std::sync::mpsc::Sender<()>,
    join_handle: std::thread::JoinHandle<Result<RecordingResult, String>>,
}

impl RecordingHandle {
    /// Signal the recording thread to stop and block until the WAV is written.
    pub(crate) fn stop(self) -> Result<RecordingResult, String> {
        let _ = self.stop_tx.send(());
        self.join_handle
            .join()
            .map_err(|_| "recording thread panicked".to_string())?
    }
}

pub(crate) fn start() -> RecordingHandle {
    let (stop_tx, stop_rx) = std::sync::mpsc::channel();
    let join_handle = std::thread::spawn(move || recording_thread(stop_rx));
    RecordingHandle {
        stop_tx,
        join_handle,
    }
}

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
    let channels = supported_config.channels();
    let config: cpal::StreamConfig = supported_config.clone().into();

    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let samples_ref = samples.clone();

    fn err_fn(err: cpal::StreamError) {
        log::error!("recording stream error: {err}");
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

    // Block until stop signal (or the handle is dropped).
    let _ = stop_rx.recv();
    drop(stream);

    let samples = samples.lock().unwrap();
    let duration = samples.len() as f64 / (sample_rate as f64 * channels as f64);

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
