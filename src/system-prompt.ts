import { readFileSync } from "node:fs";

export function getSystemPrompt(cwd: string, promptPath: string): string {
  const base = readFileSync(promptPath, "utf-8");
  return `${base}\n\n## Environment\n- Working directory: ${cwd}`;
}
