import { execFile } from "node:child_process";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Transcriber {
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<string | null>;
}

function extensionForMime(mimeType: string): string {
  const sub = mimeType.split("/")[1]?.split(";")[0] ?? "ogg";
  const map: Record<string, string> = { mpeg: "mp3", ogg: "ogg", wav: "wav", webm: "webm", mp4: "m4a" };
  return map[sub] ?? sub;
}

export class CliTranscriber implements Transcriber {
  constructor(private modelPath: string) {}

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string | null> {
    const dir = await mkdtemp(join(tmpdir(), "sam-transcribe-"));
    const ext = extensionForMime(mimeType);
    const inputPath = join(dir, `input.${ext}`);
    const wavPath = join(dir, "output.wav");

    try {
      await writeFile(inputPath, audioBuffer);

      // Convert to 16kHz mono WAV
      await execFileAsync("ffmpeg", ["-i", inputPath, "-ar", "16000", "-ac", "1", wavPath]);

      // Run transcription CLI
      const { stdout } = await execFileAsync("transcribe", [wavPath, this.modelPath], {
        shell: "/bin/sh",
        env: { ...process.env, PATH: process.env.PATH },
      });

      // Parse "Transcription: "quoted text""
      const match = stdout.match(/Transcription:\s*"(.+?)"/);
      return match?.[1] ?? null;
    } catch (err) {
      console.error("Transcription failed:", err);
      return null;
    } finally {
      await unlink(inputPath).catch(() => {});
      await unlink(wavPath).catch(() => {});
      await unlink(dir).catch(() => {});
    }
  }
}
