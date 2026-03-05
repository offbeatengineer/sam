import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { KitsServer } from "../kits-server.js";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";

const Parameters = Type.Object({
  action: Type.Union(
    [
      Type.Literal("create"),
      Type.Literal("update_file"),
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
  icon: Type.Optional(Type.String({ description: "Icon name for the kit (used with 'create' action)" })),
  filePath: Type.Optional(Type.String({ description: "Relative file path within the kit directory (used with 'update_file' action)" })),
  content: Type.Optional(Type.String({ description: "File content (used with 'update_file' action)" })),
});

type Params = Static<typeof Parameters>;

export function createKitTool(kitsServer: KitsServer, kitsDir: string): AgentTool {
  return {
    name: "manage_kit",
    label: "Manage Kit",
    description:
      "Manage kits — self-contained mini-apps with their own React frontend and TypeScript backend. " +
      "Actions: 'create' (scaffold a new kit), 'update_file' (write/update a file in a kit), " +
      "'build' (build the kit's frontend), 'reload' (hot-reload the kit's backend), " +
      "'enable'/'disable' (toggle a kit), 'delete' (remove a kit), 'list' (list all kits). " +
      "Kit files live in ~/.sam/kits/<kitId>/. Each kit has a kit.json manifest, " +
      "a client/ directory (React + Vite frontend), and a server/ directory (Hono backend). " +
      "The kit's backend exports a function that receives a KitContext with a shared SQLite database. " +
      "After creating/updating a kit, call 'build' then 'reload' to make changes live.",
    parameters: Parameters,

    async execute(_toolCallId: string, raw: unknown): Promise<AgentToolResult<undefined>> {
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

          // Create directory structure
          mkdirSync(resolve(kitDir, "client", "src"), { recursive: true });
          mkdirSync(resolve(kitDir, "server"), { recursive: true });

          // Write manifest
          const manifest = {
            id: params.kitId,
            name: params.name,
            version: "1.0.0",
            description: params.description ?? "",
            icon: params.icon ?? "box",
            enabled: true,
          };
          writeFileSync(resolve(kitDir, "kit.json"), JSON.stringify(manifest, null, 2));

          // Write server boilerplate
          writeFileSync(
            resolve(kitDir, "server", "index.ts"),
            `import { Hono } from "hono";
import type { KitContext } from "../../../agent/src/kits-server";

export default function(ctx: KitContext): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, kitId: ctx.kitId }));

  return app;
}
`,
          );

          // Write client boilerplate
          writeFileSync(
            resolve(kitDir, "client", "package.json"),
            JSON.stringify(
              {
                name: `kit-${params.kitId}`,
                private: true,
                type: "module",
                scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
                dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
                devDependencies: {
                  "@vitejs/plugin-react": "^4.0.0",
                  vite: "^6.0.0",
                  tailwindcss: "^4.0.0",
                  "@tailwindcss/vite": "^4.0.0",
                },
              },
              null,
              2,
            ),
          );

          writeFileSync(
            resolve(kitDir, "client", "vite.config.ts"),
            `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/kits/${params.kitId}/",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
`,
          );

          writeFileSync(
            resolve(kitDir, "client", "index.html"),
            `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${params.name}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`,
          );

          writeFileSync(
            resolve(kitDir, "client", "src", "main.tsx"),
            `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
`,
          );

          writeFileSync(
            resolve(kitDir, "client", "src", "App.tsx"),
            `import React from "react";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="text-2xl font-bold text-gray-900">${params.name}</h1>
      <p className="mt-2 text-gray-600">${params.description ?? "A new kit"}</p>
    </div>
  );
}
`,
          );

          writeFileSync(
            resolve(kitDir, "client", "src", "index.css"),
            `@import "tailwindcss";
`,
          );

          return ok(`Kit "${params.kitId}" created at ${kitDir}. Use 'update_file' to add functionality, then 'build' and 'reload' to make it live.`);
        }

        case "update_file": {
          if (!params.kitId) return err("kitId is required for 'update_file' action");
          if (!params.filePath) return err("filePath is required for 'update_file' action");
          if (params.content === undefined) return err("content is required for 'update_file' action");

          const kitDir = resolve(kitsDir, params.kitId);
          if (!existsSync(resolve(kitDir, "kit.json"))) {
            return err(`Kit "${params.kitId}" does not exist`);
          }

          // Security: prevent path traversal
          const fullPath = resolve(kitDir, params.filePath);
          if (!fullPath.startsWith(kitDir)) {
            return err("filePath must not escape the kit directory");
          }

          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, params.content, "utf-8");

          return ok(`Updated ${params.filePath} in kit "${params.kitId}".`);
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
): Promise<AgentToolResult<undefined>> {
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

function ok(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

function err(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text: `Error: ${text}` }], details: undefined };
}
