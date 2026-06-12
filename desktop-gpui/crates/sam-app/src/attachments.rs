//! Attachment preparation: resize images to JPEG (port of
//! `desktop/src/lib/imageResize.ts` — max dim 1024, quality 85) and stage
//! them as temp files for `POST /upload`.

use std::path::{Path, PathBuf};

const MAX_DIM: u32 = 1024;
const JPEG_QUALITY: u8 = 85;

pub const MAX_IMAGES: usize = 5;

pub fn is_image_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "heic" | "gif" | "bmp" | "tiff")
    )
}

/// Load, downscale to fit MAX_DIM, re-encode as JPEG, and write to a temp
/// file. Returns the temp path. Heavy — run on a background executor.
pub fn prepare_image(source: &Path) -> Result<PathBuf, String> {
    let img = image::open(source).map_err(|e| format!("failed to read image: {e}"))?;
    let (w, h) = (img.width(), img.height());
    let img = if w > MAX_DIM || h > MAX_DIM {
        img.resize(MAX_DIM, MAX_DIM, image::imageops::FilterType::Triangle)
    } else {
        img
    };

    let path = std::env::temp_dir().join(format!("sam_img_{}.jpg", uuid::Uuid::new_v4()));
    let mut out = std::io::BufWriter::new(
        std::fs::File::create(&path).map_err(|e| format!("temp file: {e}"))?,
    );
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    // JPEG has no alpha; flatten first.
    img.to_rgb8()
        .write_with_encoder(encoder)
        .map_err(|e| format!("jpeg encode: {e}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resizes_large_image_to_jpeg() {
        let src = std::env::temp_dir().join("sam_test_large.png");
        image::RgbaImage::from_pixel(2000, 500, image::Rgba([200, 30, 30, 255]))
            .save(&src)
            .unwrap();

        let out = prepare_image(&src).unwrap();
        let result = image::open(&out).unwrap();
        assert!(result.width() <= MAX_DIM && result.height() <= MAX_DIM);
        assert_eq!(result.width(), 1024); // 2000x500 → 1024x256
        assert!(out.extension().is_some_and(|e| e == "jpg"));

        let _ = std::fs::remove_file(src);
        let _ = std::fs::remove_file(out);
    }

    #[test]
    fn image_path_detection() {
        use std::path::Path;
        assert!(is_image_path(Path::new("/a/b.PNG")));
        assert!(is_image_path(Path::new("shot.jpeg")));
        assert!(!is_image_path(Path::new("notes.txt")));
        assert!(!is_image_path(Path::new("noext")));
    }
}
