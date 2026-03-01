import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** External deps directory — outside the project so the dev watcher ignores it */
const DEPS_DIR = resolve(homedir(), ".sam", "deps");

const moduleCache = new Map<string, Promise<any>>();

/**
 * Dynamically import a package, auto-installing it if not found.
 * Installs to ~/.sam/deps/ to avoid triggering the dev-mode file watcher.
 * Caches loaded modules so subsequent calls are instant.
 */
export async function lazyImport<T>(packageName: string, _agentDir: string): Promise<T> {
  const cached = moduleCache.get(packageName);
  if (cached) return cached as Promise<T>;

  const promise = doImport<T>(packageName);
  moduleCache.set(packageName, promise);

  try {
    return await promise;
  } catch (err) {
    // Reset cache on failure so retries work
    moduleCache.delete(packageName);
    throw err;
  }
}

function importFromDeps<T>(packageName: string): Promise<T> {
  const req = createRequire(resolve(DEPS_DIR, "index.cjs"));
  const resolved = req.resolve(packageName);
  return import(pathToFileURL(resolved).href);
}

function ensureDepsDir(): void {
  mkdirSync(DEPS_DIR, { recursive: true });
  const pkgJson = resolve(DEPS_DIR, "package.json");
  if (!existsSync(pkgJson)) {
    writeFileSync(pkgJson, '{"private":true}');
  }
}

async function doImport<T>(packageName: string): Promise<T> {
  // Try regular import first (already a declared dependency)
  try {
    return await import(packageName);
  } catch (err: any) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND" && err?.code !== "MODULE_NOT_FOUND") {
      throw err;
    }
  }

  // Try importing from the external deps directory
  try {
    return await importFromDeps<T>(packageName);
  } catch {
    // Not installed there either — fall through to install
  }

  console.log(`[memory] Installing ${packageName}... this may take a moment.`);
  ensureDepsDir();

  // Some packages (e.g. @lancedb/lancedb → apache-arrow) need tslib at runtime
  // but npm doesn't always hoist it. Install it alongside to be safe.
  const extras = packageName === "@lancedb/lancedb" ? " tslib" : "";

  try {
    execSync(`npm install ${packageName}${extras}`, {
      cwd: DEPS_DIR,
      stdio: "pipe",
      timeout: 120_000,
    });
  } catch (installErr) {
    throw new Error(
      `[memory] Failed to install ${packageName}: ${installErr instanceof Error ? installErr.message : String(installErr)}`,
    );
  }

  try {
    return await importFromDeps<T>(packageName);
  } catch (err) {
    throw new Error(
      `[memory] Installed ${packageName} but failed to import it: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
