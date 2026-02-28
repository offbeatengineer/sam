import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/plugin-fs";

const APP_DIR = ".sam";
const SETTINGS_FILE = `${APP_DIR}/settings.json`;

// ============ App Settings ============

export interface AppSettings {
  samUrl?: string;
}

async function ensureAppDir(): Promise<void> {
  if (!(await exists(APP_DIR, { baseDir: BaseDirectory.Home }))) {
    await mkdir(APP_DIR, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

export async function loadSettings(): Promise<AppSettings> {
  if (!(await exists(SETTINGS_FILE, { baseDir: BaseDirectory.Home }))) {
    return {};
  }
  try {
    const content = await readTextFile(SETTINGS_FILE, {
      baseDir: BaseDirectory.Home,
    });
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureAppDir();
  await writeTextFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), {
    baseDir: BaseDirectory.Home,
  });
}
