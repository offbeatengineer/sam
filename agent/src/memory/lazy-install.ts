import { execSync } from "node:child_process";

const moduleCache = new Map<string, Promise<any>>();

/**
 * Dynamically import a package, auto-installing it if not found.
 * Caches loaded modules so subsequent calls are instant.
 */
export async function lazyImport<T>(packageName: string, agentDir: string): Promise<T> {
  const cached = moduleCache.get(packageName);
  if (cached) return cached as Promise<T>;

  const promise = doImport<T>(packageName, agentDir);
  moduleCache.set(packageName, promise);

  try {
    return await promise;
  } catch (err) {
    // Reset cache on failure so retries work
    moduleCache.delete(packageName);
    throw err;
  }
}

async function doImport<T>(packageName: string, agentDir: string): Promise<T> {
  try {
    return await import(packageName);
  } catch (err: any) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND" && err?.code !== "MODULE_NOT_FOUND") {
      throw err;
    }
  }

  console.log(`[memory] Installing ${packageName}... this may take a moment.`);
  try {
    execSync(`npm install --no-save ${packageName}`, {
      cwd: agentDir,
      stdio: "pipe",
      timeout: 120_000,
    });
  } catch (installErr) {
    throw new Error(
      `[memory] Failed to install ${packageName}: ${installErr instanceof Error ? installErr.message : String(installErr)}`,
    );
  }

  try {
    return await import(packageName);
  } catch (err) {
    throw new Error(
      `[memory] Installed ${packageName} but failed to import it: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
