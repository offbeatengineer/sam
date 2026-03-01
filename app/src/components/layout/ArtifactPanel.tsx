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
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";

type LoadingState = "loading" | "success" | "error";

function getFileExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() || "";
}

function isMarkdownFile(path: string): boolean {
  const ext = getFileExtension(path);
  return ["md", "mdx", "markdown"].includes(ext);
}

function isImageFile(path: string): boolean {
  const ext = getFileExtension(path);
  return ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext);
}

function isHtmlFile(path: string): boolean {
  return getFileExtension(path) === "html";
}

/**
 * Check if a file path is under the artifacts directory (~/.sam/artifacts/).
 * Handles both expanded home paths and the tilde shorthand.
 */
function isArtifactPath(path: string, artifactsDir: string): boolean {
  // Normalize: the artifactsDir from settings is "~/.sam/artifacts/"
  // The actual file path will have the home dir expanded
  const normalizedDir = artifactsDir.replace(/^~/, "");
  return path.includes(normalizedDir) || path.includes("/.sam/artifacts/");
}

// Whitelist of safe HTML elements to allow in markdown
// This enables <br> tags while preventing XSS attacks
const ALLOWED_MARKDOWN_ELEMENTS = [
  // Standard markdown elements
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote", "pre", "code",
  "em", "strong", "del", "s",
  "a", "img",
  "table", "thead", "tbody", "tr", "th", "td",
  "hr",
  // Safe HTML elements
  "br", "span", "div",
  "sub", "sup",
];

function getLanguageFromExtension(ext: string): string {
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    css: "css",
    scss: "scss",
    html: "html",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
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

type ViewMode = "preview" | "code";

export function ArtifactPanel() {
  const { selectedArtifact, setSelectedArtifact } = useUIStore();
  const { artifactsUrl, artifactsDir } = useSettingsStore();
  const [content, setContent] = useState<string>("");
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [error, setError] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("preview");

  // Load file content
  useEffect(() => {
    if (!selectedArtifact?.path) return;

    // Reset state
    setContent("");
    setLoadingState("loading");
    setError("");

    // Images don't need content loading
    if (isImageFile(selectedArtifact.path)) {
      setLoadingState("success");
      return;
    }

    // Load text content
    readTextFile(selectedArtifact.path)
      .then((text) => {
        setContent(text);
        setLoadingState("success");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to read file");
        setLoadingState("error");
      });
  }, [selectedArtifact?.path]);

  const handleClose = () => {
    setSelectedArtifact(null);
  };

  const handleOpenInFinder = async () => {
    if (selectedArtifact?.path) {
      try {
        await revealItemInDir(selectedArtifact.path);
      } catch (err) {
        console.error("Failed to open in Finder:", err);
      }
    }
  };

  const handleRefresh = () => {
    if (!selectedArtifact?.path) return;

    setLoadingState("loading");
    setError("");

    if (isImageFile(selectedArtifact.path)) {
      setLoadingState("success");
      return;
    }

    readTextFile(selectedArtifact.path)
      .then((text) => {
        setContent(text);
        setLoadingState("success");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to read file");
        setLoadingState("error");
      });
  };

  const isOpen = selectedArtifact !== null;
  const ext = getFileExtension(selectedArtifact?.path || "");
  const isMarkdown = isMarkdownFile(selectedArtifact?.path || "");
  const isImage = isImageFile(selectedArtifact?.path || "");
  const isHtml = isHtmlFile(selectedArtifact?.path || "");
  const isArtifact = isArtifactPath(selectedArtifact?.path || "", artifactsDir);
  const canPreview = isHtml && isArtifact;

  // Compute iframe URL for HTML artifacts
  const iframeUrl = canPreview && selectedArtifact?.path
    ? (() => {
        // Extract the relative path after .sam/artifacts/
        const marker = "/.sam/artifacts/";
        const idx = selectedArtifact.path.indexOf(marker);
        if (idx === -1) return null;
        const relativePath = selectedArtifact.path.slice(idx + marker.length);
        return `${artifactsUrl}/${relativePath}`;
      })()
    : null;

  return (
    <div
      className={cn(
        "bg-sidebar border-l border-sidebar-border flex flex-col transition-all duration-300 ease-in-out overflow-hidden",
        isOpen ? "flex-1 min-w-0" : "w-0 border-l-0"
      )}
    >
      {isOpen && selectedArtifact && (
        <>
          {/* Header */}
          <div
            data-tauri-drag-region
            className="flex items-center justify-between h-12 px-3 border-b border-border shrink-0"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {getFileIcon(selectedArtifact.path || "")}
              <span className="text-sm font-medium truncate">
                {selectedArtifact.name}
              </span>
              <span className="text-xs text-muted-foreground uppercase">
                {ext || "file"}
              </span>
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
              <Button
                variant="ghost"
                size="icon"
                onClick={handleOpenInFinder}
                className="h-8 w-8"
                title="Open in Finder"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                className="h-8 w-8"
                title="Refresh"
              >
                <RotateCw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-8 w-8"
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* File path */}
          <div className="px-3 py-2 border-b border-border shrink-0">
            <p className="text-xs text-muted-foreground truncate" title={selectedArtifact.path}>
              {selectedArtifact.path}
            </p>
          </div>

          {/* Content */}
          {canPreview && viewMode === "preview" && iframeUrl ? (
            <div className="flex-1 min-h-0">
              <iframe
                src={iframeUrl}
                sandbox="allow-scripts allow-modals"
                className="w-full h-full border-0"
                title={selectedArtifact.name}
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
                    src={convertFileSrc(selectedArtifact.path || "")}
                    alt={selectedArtifact.name}
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

                        // HTTP URLs don't need conversion
                        if (src.startsWith('http://') || src.startsWith('https://')) {
                          return <img src={src} alt={alt} {...props} />;
                        }

                        // Resolve relative paths against the markdown file's directory
                        let imagePath = src;
                        if (!src.startsWith('/')) {
                          const dir = selectedArtifact.path?.replace(/[^/]+$/, '') || '';
                          imagePath = dir + src;
                        }

                        // Convert to Tauri protocol for local files
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
        </>
      )}
    </div>
  );
}
