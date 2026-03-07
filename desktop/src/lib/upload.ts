import { invoke } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useSettingsStore } from "@/stores/settingsStore";

interface UploadResult {
  id: string;
  path: string;
  mimeType: string;
}

export async function uploadFile(
  blob: Blob,
  mimeType: string,
): Promise<UploadResult> {
  const { artifactsUrl } = useSettingsStore.getState();
  const instance = useSettingsStore.getState().getActiveInstance();
  const apiKey = instance?.apiKey;

  // Save blob to a temp file so Rust can read it
  const ext = extForMime(mimeType);
  const tempPath = `/tmp/sam_upload_${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(tempPath, bytes);

  // Upload from Rust (bypasses CORS)
  return invoke<UploadResult>("upload_file", {
    filePath: tempPath,
    uploadUrl: `${artifactsUrl}/upload`,
    apiKey: apiKey || null,
    mimeType,
  });
}

function extForMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("webm")) return "webm";
  return "bin";
}
