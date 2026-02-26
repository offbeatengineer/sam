use std::env;
use std::fs;
use std::path::Path;

fn main() {
    // Run Tauri build
    tauri_build::build();

    // Copy blueprint folder to target directory for dev mode
    copy_blueprint_to_target();
}

fn copy_blueprint_to_target() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let profile = env::var("PROFILE").unwrap(); // "debug" or "release"

    let source = Path::new(&manifest_dir).join("blueprint");
    let target_dir = Path::new(&manifest_dir)
        .join("target")
        .join(&profile)
        .join("blueprint");

    // Re-run build script if blueprint changes
    println!("cargo:rerun-if-changed=blueprint");

    if source.exists() {
        // Remove old target blueprint if exists
        if target_dir.exists() {
            let _ = fs::remove_dir_all(&target_dir);
        }

        // Copy blueprint to target
        if let Err(e) = copy_dir_recursive(&source, &target_dir) {
            println!("cargo:warning=Failed to copy blueprint: {}", e);
        } else {
            println!("cargo:warning=Copied blueprint to {:?}", target_dir);
        }
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}
