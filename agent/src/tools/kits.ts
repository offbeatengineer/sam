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
  icon: Type.Optional(Type.String({ description: "Icon name for the kit (used with 'create' action). Valid names: box, sparkles, calculator, calendar, camera, chart-bar, chart-line, chart-pie, check-list, clock, cloud, code, coins, compass, database, file-text, folder, gamepad, globe, graduation-cap, heart, home, image, inbox, key, layers, lightbulb, link, list, mail, map, megaphone, message, mic, music, notebook, palette, pen, pizza, plane, puzzle, receipt, rocket, search, shield, shopping-cart, star, sun, tag, timer, trophy, users, wallet, wrench, zap" })),
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
      "The kit's backend exports a Hono router that receives a KitContext with a shared SQLite database. " +
      "Frontend must use kit.fetch() from @/lib/kit for API calls — it handles routing automatically. " +
      "Frontend and backend use the same paths: if backend defines app.get('/todos'), frontend calls kit.fetch('/todos'). " +
      "After creating/updating a kit, call 'build' then 'reload' to make changes live. " +
      "When creating a kit, choose an icon from this set: box, sparkles, calculator, calendar, camera, " +
      "chart-bar, chart-line, chart-pie, check-list, clock, cloud, code, coins, compass, database, " +
      "file-text, folder, gamepad, globe, graduation-cap, heart, home, image, inbox, key, layers, " +
      "lightbulb, link, list, mail, map, megaphone, message, mic, music, notebook, palette, pen, " +
      "pizza, plane, puzzle, receipt, rocket, search, shield, shopping-cart, star, sun, tag, timer, " +
      "trophy, users, wallet, wrench, zap. " +
      "The kit scaffold is pre-configured for shadcn/ui (Tailwind v4). " +
      "For complex kits, delegate coding to pi via the coding-agent skill with cwd set to ~/.sam/kits/<kitId>.",
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
            icon: params.icon ?? "sparkles",
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
                dependencies: {
                  react: "^19.0.0",
                  "react-dom": "^19.0.0",
                  clsx: "^2.1.0",
                  "tailwind-merge": "^3.0.0",
                  "class-variance-authority": "^0.7.0",
                  "lucide-react": "^0.400.0",
                },
                devDependencies: {
                  "@vitejs/plugin-react": "^4.0.0",
                  vite: "^6.0.0",
                  tailwindcss: "^4.0.0",
                  "@tailwindcss/vite": "^4.0.0",
                  "tw-animate-css": "^1.0.0",
                  typescript: "^5.6.0",
                  "@types/react": "^19.0.0",
                  "@types/react-dom": "^19.0.0",
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
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/kits/${params.kitId}/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
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
            `import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
`,
          );

          writeFileSync(
            resolve(kitDir, "client", "src", "App.tsx"),
            `export default function App() {
  return (
    <div className="min-h-screen bg-background p-6">
      <h1 className="text-2xl font-bold text-foreground">${params.name}</h1>
      <p className="mt-2 text-muted-foreground">${params.description ?? "A new kit"}</p>
    </div>
  );
}
`,
          );

          // Shared utilities
          mkdirSync(resolve(kitDir, "client", "src", "lib"), { recursive: true });

          // Kit HTTP client — handles routing prefix so FE and BE use the same paths
          writeFileSync(
            resolve(kitDir, "client", "src", "lib", "kit.ts"),
            `const API_PREFIX = \`\${import.meta.env.BASE_URL}api\`;

/** Fetch wrapper that routes to this kit's backend.
 *  Use the same paths as your Hono routes:
 *    kit.fetch("/todos")  →  GET /todos on the backend
 */
export const kit = {
  fetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(\`\${API_PREFIX}\${path}\`, init);
  },
};
`,
          );

          // shadcn/ui cn() utility
          writeFileSync(
            resolve(kitDir, "client", "src", "lib", "utils.ts"),
            `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
          );

          // shadcn/ui components.json
          writeFileSync(
            resolve(kitDir, "client", "components.json"),
            JSON.stringify(
              {
                $schema: "https://ui.shadcn.com/schema.json",
                style: "new-york",
                rsc: false,
                tsx: true,
                tailwind: {
                  config: "",
                  css: "src/index.css",
                  baseColor: "neutral",
                  cssVariables: true,
                },
                aliases: {
                  utils: "@/lib/utils",
                  components: "@/components",
                  ui: "@/components/ui",
                  lib: "@/lib",
                  hooks: "@/hooks",
                },
              },
              null,
              2,
            ),
          );

          // TypeScript config for @/ path alias
          writeFileSync(
            resolve(kitDir, "client", "tsconfig.json"),
            JSON.stringify(
              {
                files: [],
                references: [{ path: "./tsconfig.app.json" }],
              },
              null,
              2,
            ),
          );

          writeFileSync(
            resolve(kitDir, "client", "tsconfig.app.json"),
            JSON.stringify(
              {
                compilerOptions: {
                  target: "ES2020",
                  useDefineForClassFields: true,
                  lib: ["ES2020", "DOM", "DOM.Iterable"],
                  module: "ESNext",
                  skipLibCheck: true,
                  moduleResolution: "bundler",
                  allowImportingTsExtensions: true,
                  isolatedModules: true,
                  moduleDetection: "force",
                  noEmit: true,
                  jsx: "react-jsx",
                  strict: true,
                  baseUrl: ".",
                  paths: { "@/*": ["./src/*"] },
                },
                include: ["src"],
              },
              null,
              2,
            ),
          );

          // Tailwind v4 + shadcn/ui CSS variables
          writeFileSync(
            resolve(kitDir, "client", "src", "index.css"),
            `@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
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
