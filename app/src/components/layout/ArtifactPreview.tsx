import { useState, useEffect } from "react";
import { X, ExternalLink, AlertCircle, Loader2, FileText, Image, FileCode, RotateCw, Eye, Code } from "lucide-react";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettingsStore } from "@/stores/settingsStore";

type LoadingState = "loading" | "success" | "error";

export function getFileExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() || "";
}

export function isMarkdownFile(path: string): boolean {
  const ext = getFileExtension(path);
  return ["md", "mdx", "markdown"].includes(ext);
}

export function isImageFile(path: string): boolean {
  const ext = getFileExtension(path);
  return ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext);
}

export function isHtmlFile(path: string): boolean {
  return getFileExtension(path) === "html";
}

export function isArtifactPath(path: string, artifactsDir: string): boolean {
  const normalizedDir = artifactsDir.replace(/^~/, "");
  return path.includes(normalizedDir) || path.includes("/.sam/artifacts/");
}

// Whitelist of safe HTML elements to allow in markdown
const ALLOWED_MARKDOWN_ELEMENTS = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote", "pre", "code",
  "em", "strong", "del", "s",
  "a", "img",
  "table", "thead", "tbody", "tr", "th", "td",
  "hr",
  "br", "span", "div",
  "sub", "sup",
];

function getLanguageFromExtension(ext: string): string {
  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", java: "java",
    c: "c", cpp: "cpp", h: "c",
    css: "css", scss: "scss", html: "html",
    json: "json", yaml: "yaml", yml: "yaml",
    toml: "toml", xml: "xml", sql: "sql",
    sh: "bash", bash: "bash", zsh: "bash",
  };
  return langMap[ext] || "text";
}

function getFileIcon(path: string) {
  if (isImageFile(path)) {
    return <Image className="h-4 w-4 text-muted-foreground" />;
  }
  const ext = getFileExtension(path);
  const codeExtensions = [
    "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h",
    "css", "scss", "html", "json", "yaml", "yml", "toml", "xml"
  ];
  if (codeExtensions.includes(ext)) {
    return <FileCode className="h-4 w-4 text-muted-foreground" />;
  }
  return <FileText className="h-4 w-4 text-muted-foreground" />;
}

// ---------------------------------------------------------------------------

export interface ArtifactInfo {
  id: string;
  name: string;
  type: string;
  path: string;
}

interface ArtifactPreviewProps {
  artifact: ArtifactInfo;
  onClose?: () => void;
}

type ViewMode = "preview" | "code";

export function ArtifactPreview({ artifact, onClose }: ArtifactPreviewProps) {
  const { artifactsUrl, artifactsDir } = useSettingsStore();
  const [content, setContent] = useState<string>("");
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [error, setError] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("preview");

  useEffect(() => {
    if (!artifact.path) return;

    setContent("");
    setLoadingState("loading");
    setError("");

    if (isImageFile(artifact.path)) {
      setLoadingState("success");
      return;
    }

    readTextFile(artifact.path)
      .then((text) => {
        setContent(text);
        setLoadingState("success");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to read file");
        setLoadingState("error");
      });
  }, [artifact.path]);

  const handleOpenInFinder = async () => {
    if (artifact.path) {
      try {
        await revealItemInDir(artifact.path);
      } catch (err) {
        console.error("Failed to open in Finder:", err);
      }
    }
  };

  const handleRefresh = () => {
    if (!artifact.path) return;
    setLoadingState("loading");
    setError("");

    if (isImageFile(artifact.path)) {
      setLoadingState("success");
      return;
    }

    readTextFile(artifact.path)
      .then((text) => {
        setContent(text);
        setLoadingState("success");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to read file");
        setLoadingState("error");
      });
  };

  const ext = getFileExtension(artifact.path);
  const isMarkdown = isMarkdownFile(artifact.path);
  const isImage = isImageFile(artifact.path);
  const isHtml = isHtmlFile(artifact.path);
  const isArtifact = isArtifactPath(artifact.path, artifactsDir);
  const canPreview = isHtml && isArtifact;

  const iframeUrl = canPreview
    ? (() => {
        const marker = "/.sam/artifacts/";
        const idx = artifact.path.indexOf(marker);
        if (idx === -1) return null;
        const relativePath = artifact.path.slice(idx + marker.length);
        return `${artifactsUrl}/${relativePath}`;
      })()
    : null;

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Header */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between h-12 px-3 border-b border-border shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {getFileIcon(artifact.path)}
          <span className="text-sm font-medium truncate">{artifact.name}</span>
          <span className="text-xs text-muted-foreground uppercase">{ext || "file"}</span>
        </div>
        <div className="flex items-center gap-1">
          {canPreview && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setViewMode(viewMode === "preview" ? "code" : "preview")}
              className="h-8 w-8"
              title={viewMode === "preview" ? "View source" : "View preview"}
            >
              {viewMode === "preview" ? <Code className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={handleOpenInFinder} className="h-8 w-8" title="Open in Finder">
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleRefresh} className="h-8 w-8" title="Refresh">
            <RotateCw className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" title="Close">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* File path */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <p className="text-xs text-muted-foreground truncate" title={artifact.path}>
          {artifact.path}
        </p>
      </div>

      {/* Content */}
      {canPreview && viewMode === "preview" && iframeUrl ? (
        <div className="flex-1 min-h-0">
          <iframe
            src={iframeUrl}
            sandbox="allow-scripts allow-modals"
            className="w-full h-full border-0"
            title={artifact.name}
          />
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4">
            {loadingState === "loading" && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {loadingState === "error" && (
              <div className="flex flex-col items-center justify-center py-12 text-destructive">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {loadingState === "success" && isImage && (
              <div className="flex items-center justify-center py-4">
                <img
                  src={convertFileSrc(artifact.path)}
                  alt={artifact.name}
                  className="max-w-full max-h-[70vh] object-contain rounded-md"
                />
              </div>
            )}

            {loadingState === "success" && !isImage && isMarkdown && (
              <div className="prose prose-neutral dark:prose-invert max-w-none text-sm [&_pre]:overflow-x-auto">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  allowedElements={ALLOWED_MARKDOWN_ELEMENTS}
                  components={{
                    img: ({ src, alt, ...props }) => {
                      if (!src) return null;
                      if (src.startsWith('http://') || src.startsWith('https://')) {
                        return <img src={src} alt={alt} {...props} />;
                      }
                      let imagePath = src;
                      if (!src.startsWith('/')) {
                        const dir = artifact.path.replace(/[^/]+$/, '') || '';
                        imagePath = dir + src;
                      }
                      return <img src={convertFileSrc(imagePath)} alt={alt} {...props} />;
                    }
                  }}
                >
                  {content}
                </ReactMarkdown>
              </div>
            )}

            {loadingState === "success" && !isImage && !isMarkdown && (
              <pre className="text-sm overflow-x-auto bg-muted/50 rounded-md p-4">
                <code className={`language-${getLanguageFromExtension(ext)}`}>
                  {content}
                </code>
              </pre>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
