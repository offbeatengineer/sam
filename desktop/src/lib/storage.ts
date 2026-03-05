import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/plugin-fs";
import type { BackendInstance } from "@/types/instance";
import { createInstance } from "@/types/instance";

const APP_DIR = ".sam";
const SETTINGS_FILE = `${APP_DIR}/settings.json`;

// ============ App Settings ============

export interface AppSettings {
  instances: BackendInstance[];
  activeInstanceId: string | null;
}

// Legacy format for migration
interface LegacySettings {
  samUrl?: string;
}

async function ensureAppDir(): Promise<void> {
  if (!(await exists(APP_DIR, { baseDir: BaseDirectory.Home }))) {
    await mkdir(APP_DIR, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

export async function loadSettings(): Promise<AppSettings> {
  if (!(await exists(SETTINGS_FILE, { baseDir: BaseDirectory.Home }))) {
    return { instances: [], activeInstanceId: null };
  }
  try {
    const content = await readTextFile(SETTINGS_FILE, {
      baseDir: BaseDirectory.Home,
    });
    const raw = JSON.parse(content);

    // Already new format
    if (Array.isArray(raw.instances)) {
      return {
        instances: raw.instances,
        activeInstanceId: raw.activeInstanceId ?? null,
      };
    }

    // Legacy migration: { samUrl: "ws://..." }
    const legacy = raw as LegacySettings;
    if (legacy.samUrl) {
      const instance = createInstance("Default", legacy.samUrl);
      const migrated: AppSettings = {
        instances: [instance],
        activeInstanceId: instance.id,
      };
      // Persist migrated format immediately
      await saveSettings(migrated);
      return migrated;
    }

    return { instances: [], activeInstanceId: null };
  } catch {
    return { instances: [], activeInstanceId: null };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureAppDir();
  await writeTextFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), {
    baseDir: BaseDirectory.Home,
  });
}
