import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { KitsServer } from "../kits-server.js";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";

const Parameters = Type.Object({
  action: Type.Union(
    [
      Type.Literal("create"),
      Type.Literal("build"),
      Type.Literal("reload"),
      Type.Literal("enable"),
      Type.Literal("disable"),
      Type.Literal("delete"),
      Type.Literal("list"),
    ],
    { description: "The action to perform on a kit" },
  ),
  kitId: Type.Optional(Type.String({ description: "The kit ID (directory name). Required for all actions except 'list'." })),
  name: Type.Optional(Type.String({ description: "Display name for the kit (used with 'create' action)" })),
  description: Type.Optional(Type.String({ description: "Description of the kit (used with 'create' action)" })),
  icon: Type.Optional(Type.String({ description: "Icon name for the kit (used with 'create' action). Valid names: box, sparkles, calculator, calendar, camera, chart-bar, chart-line, chart-pie, check-list, clock, cloud, code, coins, compass, database, file-text, folder, gamepad, globe, graduation-cap, heart, home, image, inbox, key, layers, lightbulb, link, list, mail, map, megaphone, message, mic, music, notebook, palette, pen, pizza, plane, puzzle, receipt, rocket, search, shield, shopping-cart, star, sun, tag, timer, trophy, users, wallet, wrench, zap" })),
});

type Params = Static<typeof Parameters>;

export function createKitTool(kitsServer: KitsServer, kitsDir: string): AgentTool {
  return {
    name: "manage_kit",
    label: "Manage Kit",
    description:
      "Manage kits — self-contained mini-apps with their own React frontend and TypeScript backend. " +
      "Actions: 'create' (scaffold a new kit), 'build' (build the kit's frontend), " +
      "'reload' (hot-reload the kit's backend), 'enable'/'disable' (toggle a kit), " +
      "'delete' (remove a kit), 'list' (list all kits). " +
      "Kit files live in ~/.sam/kits/<kitId>/. After 'create', use the coding-agent skill " +
      "with cwd set to ~/.sam/kits/<kitId> to implement the kit's functionality. " +
      "Then call 'build' and 'reload' to make changes live. " +
      "When creating a kit, choose an icon from this set: box, sparkles, calculator, calendar, camera, " +
      "chart-bar, chart-line, chart-pie, check-list, clock, cloud, code, coins, compass, database, " +
      "file-text, folder, gamepad, globe, graduation-cap, heart, home, image, inbox, key, layers, " +
      "lightbulb, link, list, mail, map, megaphone, message, mic, music, notebook, palette, pen, " +
      "pizza, plane, puzzle, receipt, rocket, search, shield, shopping-cart, star, sun, tag, timer, " +
      "trophy, users, wallet, wrench, zap.",
    parameters: Parameters,

    async execute(_toolCallId: string, raw: unknown): Promise<AgentToolResult<any>> {
      const params = raw as Params;

      switch (params.action) {
        case "list": {
          const kits = kitsServer.getKits();
          return {
            content: [{ type: "text", text: JSON.stringify(kits, null, 2) }],
            details: undefined,
          };
        }

        case "create": {
          if (!params.kitId) return err("kitId is required for 'create' action");
          if (!params.name) return err("name is required for 'create' action");

          const kitDir = resolve(kitsDir, params.kitId);
          if (existsSync(resolve(kitDir, "kit.json"))) {
            return err(`Kit "${params.kitId}" already exists`);
          }

          // Write manifest
          mkdirSync(kitDir, { recursive: true });
          const manifest = {
            id: params.kitId,
            name: params.name,
            version: "1.0.0",
            description: params.description ?? "",
            icon: params.icon ?? "sparkles",
            enabled: true,
          };
          writeFileSync(resolve(kitDir, "kit.json"), JSON.stringify(manifest, null, 2));

          // Copy template files with variable substitution
          const templateDir = resolve(import.meta.dir, "..", "kit-template");
          const vars: Record<string, string> = {
            kitId: params.kitId,
            name: params.name,
            description: params.description ?? "A new kit",
          };
          scaffoldFromTemplate(templateDir, kitDir, vars);

          // Symlink CLAUDE.md -> AGENTS.md so Claude Code picks up kit guidelines
          symlinkSync("AGENTS.md", resolve(kitDir, "CLAUDE.md"));

          return {
            content: [{ type: "text", text: `Kit "${params.kitId}" scaffolded at ${kitDir}. Now use the coding-agent skill with cwd=${kitDir} to implement the kit's functionality. After coding is done, call 'build' then 'reload' to make it live.` }],
            details: { action: "created", manifest },
          };
        }

        case "build": {
          if (!params.kitId) return err("kitId is required for 'build' action");
          await kitsServer.buildKit(params.kitId);
          return ok(`Kit "${params.kitId}" frontend built.`);
        }

        case "reload": {
          if (!params.kitId) return err("kitId is required for 'reload' action");
          await kitsServer.reloadKit(params.kitId);
          return ok(`Kit "${params.kitId}" reloaded.`);
        }

        case "enable": {
          if (!params.kitId) return err("kitId is required for 'enable' action");
          return toggleKit(kitsDir, kitsServer, params.kitId, true);
        }

        case "disable": {
          if (!params.kitId) return err("kitId is required for 'disable' action");
          return toggleKit(kitsDir, kitsServer, params.kitId, false);
        }

        case "delete": {
          if (!params.kitId) return err("kitId is required for 'delete' action");
          const kitDir = resolve(kitsDir, params.kitId);
          if (!existsSync(kitDir)) {
            return err(`Kit "${params.kitId}" does not exist`);
          }
          await kitsServer.unloadKit(params.kitId);
          rmSync(kitDir, { recursive: true, force: true });
          return ok(`Kit "${params.kitId}" deleted.`);
        }

        default:
          return err(`Unknown action: ${params.action}`);
      }
    },
  };
}

async function toggleKit(
  kitsDir: string,
  kitsServer: KitsServer,
  kitId: string,
  enabled: boolean,
): Promise<AgentToolResult<any>> {
  const manifestPath = resolve(kitsDir, kitId, "kit.json");
  if (!existsSync(manifestPath)) {
    return err(`Kit "${kitId}" does not exist`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.enabled = enabled;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  if (enabled) {
    await kitsServer.loadKit(kitId);
  } else {
    await kitsServer.unloadKit(kitId);
  }

  return ok(`Kit "${kitId}" ${enabled ? "enabled" : "disabled"}.`);
}

function ok(text: string): AgentToolResult<any> {
  return { content: [{ type: "text", text }], details: undefined };
}

function err(text: string): AgentToolResult<any> {
  return { content: [{ type: "text", text: `Error: ${text}` }], details: undefined };
}

/** Recursively copy a template directory, replacing {{var}} placeholders in file contents. */
function scaffoldFromTemplate(templateDir: string, destDir: string, vars: Record<string, string>): void {
  for (const entry of readdirSync(templateDir)) {
    const srcPath = resolve(templateDir, entry);
    const destPath = resolve(destDir, entry);

    if (statSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      scaffoldFromTemplate(srcPath, destPath, vars);
    } else {
      let content = readFileSync(srcPath, "utf-8");
      for (const [key, value] of Object.entries(vars)) {
        content = content.replaceAll(`{{${key}}}`, value);
      }
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, content);
    }
  }
}
