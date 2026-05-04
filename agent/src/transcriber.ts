import { execFile } from "node:child_process";
import { writeFile, mkdtemp, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 10 * 1024 * 1024;
const RETRY_DEBOUNCE_MS = 60_000;

export interface TranscriptionConfig {
  enabled: boolean;
  model?: "small" | "large";
  // Language hint passed as `vocal asr -l <code>`. Omit (or leave unset) for auto-detect.
  language?: string;
  threads?: number;
  binaryPath?: string;
  modelDir?: string;
  timeoutMs?: number;
}

export type TranscribeResult =
  | { ok: true; text: string }
  | {
      ok: false;
      reason: "disabled" | "not-ready" | "failed" | "transcribe-error";
      message: string;
    };

export type TranscriberPhase =
  | "disabled"
  | "installing"
  | "downloading-model"
  | "ready"
  | "failed";

export interface TranscriberStatus {
  phase: TranscriberPhase;
  message?: string;
}

export interface Transcriber {
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<TranscribeResult>;
  getStatus(): TranscriberStatus;
  ensureReady(): Promise<void>;
}

function extensionForMime(mimeType: string): string {
  const sub = mimeType.split("/")[1]?.split(";")[0] ?? "ogg";
  const map: Record<string, string> = {
    mpeg: "mp3",
    ogg: "ogg",
    wav: "wav",
    webm: "webm",
    mp4: "m4a",
  };
  return map[sub] ?? sub;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isOnPath(name: string): Promise<boolean> {
  try {
    await execFileAsync("/usr/bin/which", [name], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function modelFilename(model: "small" | "large"): string {
  return model === "large"
    ? "qwen3-asr-1.7b-f16.gguf"
    : "qwen3-asr-0.6b-f16.gguf";
}

function defaultModelDir(): string {
  return process.env.VOCAL_MODELS_DIR ?? resolve(homedir(), ".vocal", "models");
}

export class VocalTranscriber implements Transcriber {
  private readonly config: Required<Pick<TranscriptionConfig, "model" | "timeoutMs">> &
    TranscriptionConfig;
  private phase: TranscriberPhase;
  private statusMessage?: string;
  private resolvedBinary?: string;
  private setupPromise?: Promise<void>;
  private lastAttemptAt = 0;
  private retryable = true;

  constructor(config: TranscriptionConfig) {
    this.config = {
      model: "small",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...config,
    };
    this.phase = config.enabled ? "installing" : "disabled";
  }

  getStatus(): TranscriberStatus {
    return { phase: this.phase, message: this.statusMessage };
  }

  ensureReady(): Promise<void> {
    if (!this.config.enabled) return Promise.resolve();
    if (this.phase === "ready") return Promise.resolve();
    if (this.setupPromise) return this.setupPromise;

    this.lastAttemptAt = Date.now();
    this.setupPromise = this.runSetup().finally(() => {
      this.setupPromise = undefined;
    });
    return this.setupPromise;
  }

  async transcribe(
    audioBuffer: Buffer,
    mimeType: string,
  ): Promise<TranscribeResult> {
    if (!this.config.enabled) {
      return {
        ok: false,
        reason: "disabled",
        message: "Audio transcription is not enabled on this server",
      };
    }

    if (this.phase !== "ready") {
      const canRetry =
        this.phase === "failed" &&
        this.retryable &&
        Date.now() - this.lastAttemptAt > RETRY_DEBOUNCE_MS;
      if (canRetry) {
        this.ensureReady().catch(() => {});
      }
      if (this.phase === "failed" && !this.retryable) {
        return {
          ok: false,
          reason: "failed",
          message: `Audio transcription setup failed: ${this.statusMessage ?? "unknown error"}`,
        };
      }
      const phaseLabel =
        this.phase === "installing"
          ? "installing vocal"
          : this.phase === "downloading-model"
            ? "downloading model"
            : this.phase === "failed"
              ? "retrying setup"
              : this.phase;
      return {
        ok: false,
        reason: "not-ready",
        message: `Audio transcription is starting up (${phaseLabel}) — please try again in a moment`,
      };
    }

    const binary = this.resolvedBinary ?? "vocal";

    const dir = await mkdtemp(join(tmpdir(), "sam-transcribe-"));
    const inputPath = join(dir, `input.${extensionForMime(mimeType)}`);
    const wavPath = join(dir, "output.wav");

    try {
      await writeFile(inputPath, audioBuffer);

      await execFileAsync(
        "ffmpeg",
        ["-loglevel", "error", "-y", "-i", inputPath, "-ar", "16000", "-ac", "1", wavPath],
        {
          timeout: this.config.timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: MAX_BUFFER,
        },
      );

      const args = ["asr", "-f", wavPath];
      if (this.config.model === "large") args.push("--large");
      if (this.config.language) args.push("-l", this.config.language);
      if (this.config.threads) args.push("-t", String(this.config.threads));
      if (this.config.modelDir) args.push("--model-dir", this.config.modelDir);

      const { stdout, stderr } = await execFileAsync(binary, args, {
        timeout: this.config.timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: MAX_BUFFER,
      });

      const text = stdout.trim();
      if (!text) {
        if (/model not found/i.test(stderr)) {
          this.phase = "failed";
          this.retryable = true;
          this.statusMessage = "ASR model file is missing";
          return {
            ok: false,
            reason: "failed",
            message: "Audio transcription failed: ASR model file is missing",
          };
        }
        return {
          ok: false,
          reason: "transcribe-error",
          message: "Audio transcription returned an empty result",
        };
      }

      return { ok: true, text };
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr;
      if (stderr && /model not found/i.test(stderr)) {
        this.phase = "failed";
        this.retryable = true;
        this.statusMessage = "ASR model file is missing";
        return {
          ok: false,
          reason: "failed",
          message: "Audio transcription failed: ASR model file is missing",
        };
      }
      console.error("[transcription] vocal asr invocation failed:", err);
      return {
        ok: false,
        reason: "transcribe-error",
        message: "Audio transcription failed",
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async runSetup(): Promise<void> {
    try {
      // 1. Ensure ffmpeg (needed to convert ogg/webm/m4a Discord audio to WAV)
      if (!(await isOnPath("ffmpeg"))) {
        this.phase = "installing";
        this.statusMessage = "running brew install ffmpeg";
        console.log("[transcription] ffmpeg not found; installing via Homebrew...");
        try {
          await execFileAsync("brew", ["install", "ffmpeg"], {
            timeout: 600_000,
            maxBuffer: MAX_BUFFER,
          });
        } catch (err) {
          this.markFailed(`brew install ffmpeg failed: ${(err as Error).message}`, true);
          return;
        }
      }

      // 2. Ensure vocal binary
      const override = this.config.binaryPath;
      if (override) {
        if (!(await pathExists(override))) {
          this.markFailed(`configured transcription.binaryPath does not exist: ${override}`, false);
          return;
        }
        this.resolvedBinary = override;
      } else if (!(await isOnPath("vocal"))) {
        this.phase = "installing";
        this.statusMessage = "running brew install offbeatengineer/tap/vocal";
        console.log("[transcription] vocal not found; installing via Homebrew...");
        try {
          await execFileAsync("brew", ["tap", "offbeatengineer/tap"], {
            timeout: 120_000,
            maxBuffer: MAX_BUFFER,
          });
          await execFileAsync("brew", ["install", "vocal"], {
            timeout: 600_000,
            maxBuffer: MAX_BUFFER,
          });
        } catch (err) {
          this.markFailed(`brew install vocal failed: ${(err as Error).message}`, true);
          return;
        }
        if (!(await isOnPath("vocal"))) {
          this.markFailed("brew install completed but vocal is still not on PATH", false);
          return;
        }
        this.resolvedBinary = "vocal";
      } else {
        this.resolvedBinary = "vocal";
      }

      // 3. Ensure ASR model
      const modelDir = this.config.modelDir ?? defaultModelDir();
      const modelPath = join(modelDir, modelFilename(this.config.model));

      if (!(await pathExists(modelPath))) {
        this.phase = "downloading-model";
        const target = this.config.model === "large" ? "asr-large" : "asr";
        this.statusMessage = `running vocal download ${target}`;
        console.log(`[transcription] downloading ${target} model (this can take a few minutes)...`);

        try {
          const downloadArgs = ["download", target];
          if (this.config.modelDir) downloadArgs.push("--model-dir", this.config.modelDir);
          await execFileAsync(this.resolvedBinary, downloadArgs, {
            timeout: 30 * 60_000,
            maxBuffer: MAX_BUFFER,
          });
        } catch (err) {
          this.markFailed(`vocal download ${target} failed: ${(err as Error).message}`, true);
          return;
        }

        if (!(await pathExists(modelPath))) {
          this.markFailed(
            `vocal download completed but model file still missing at ${modelPath}`,
            true,
          );
          return;
        }
      }

      this.phase = "ready";
      this.statusMessage = undefined;
      this.retryable = true;
      console.log("[transcription] ready");
    } catch (err) {
      this.markFailed(`unexpected setup error: ${(err as Error).message}`, true);
    }
  }

  private markFailed(message: string, retryable: boolean): void {
    this.phase = "failed";
    this.statusMessage = message;
    this.retryable = retryable;
    console.error(`[transcription] setup failed: ${message}`);
  }
}
