import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { extname } from "node:path";

const Parameters = Type.Object({
  path: Type.String({
    description: "File path relative to ~/.sam/artifacts/ (e.g. 'dashboard.html' or 'charts/revenue.html')",
  }),
  title: Type.String({ description: "Human-readable title for the artifact" }),
  description: Type.Optional(Type.String({ description: "Brief description of the artifact" })),
  type: Type.Optional(
    Type.Union(
      [
        Type.Literal("html"),
        Type.Literal("image"),
        Type.Literal("markdown"),
        Type.Literal("code"),
        Type.Literal("data"),
        Type.Literal("other"),
      ],
      { description: "Artifact type. Auto-detected from file extension if omitted." },
    ),
  ),
});

type Params = Static<typeof Parameters>;

export interface ReportArtifactDetails {
  path: string;
  title: string;
  description?: string;
  type: string;
}

const EXT_TYPE_MAP: Record<string, string> = {
  ".html": "html",
  ".htm": "html",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".svg": "image",
  ".webp": "image",
  ".md": "markdown",
  ".markdown": "markdown",
  ".ts": "code",
  ".tsx": "code",
  ".js": "code",
  ".jsx": "code",
  ".py": "code",
  ".rs": "code",
  ".go": "code",
  ".java": "code",
  ".c": "code",
  ".cpp": "code",
  ".css": "code",
  ".scss": "code",
  ".json": "data",
  ".csv": "data",
  ".yaml": "data",
  ".yml": "data",
  ".toml": "data",
  ".xml": "data",
};

function detectType(path: string): string {
  const ext = extname(path).toLowerCase();
  return EXT_TYPE_MAP[ext] ?? "other";
}

export function createReportArtifactTool(): AgentTool {
  return {
    name: "report_artifact",
    label: "Report Artifact",
    description:
      "Report an artifact that was created or updated in ~/.sam/artifacts/. " +
      "This renders an inline card in the chat so the user can preview or open the file. " +
      "Call this after writing files to the artifacts directory.",
    parameters: Parameters,
    async execute(_toolCallId: string, raw: unknown): Promise<AgentToolResult<ReportArtifactDetails>> {
      const params = raw as Params;
      const artifactType = params.type ?? detectType(params.path);

      const details: ReportArtifactDetails = {
        path: params.path,
        title: params.title,
        description: params.description,
        type: artifactType,
      };

      return {
        content: [
          {
            type: "text",
            text: `Artifact reported: ${params.title} (${artifactType}) at artifacts/${params.path}`,
          },
        ],
        details,
      };
    },
  };
}
