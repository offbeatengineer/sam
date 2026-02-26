import { useState, useCallback } from "react";
import { Upload } from "lucide-react";
import { writeFile } from "@tauri-apps/plugin-fs";

interface FileDropzoneProps {
  workingDirectory: string;
}

export function FileDropzone({ workingDirectory }: FileDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      setIsCopying(true);
      setStatus(null);

      try {
        for (const file of files) {
          const arrayBuffer = await file.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          const destPath = `${workingDirectory}/${file.name}`;
          await writeFile(destPath, uint8Array);
        }
        setStatus({
          type: "success",
          message: files.length === 1 ? "File added" : `${files.length} files added`,
        });
        setTimeout(() => setStatus(null), 2000);
      } catch (error) {
        console.error("Failed to copy files:", error);
        setStatus({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to copy files",
        });
      } finally {
        setIsCopying(false);
      }
    },
    [workingDirectory]
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        mt-3 p-3 rounded-md border-2 border-dashed transition-colors
        flex flex-col items-center justify-center gap-1 text-center
        ${isDragOver
          ? "border-primary bg-primary/10"
          : "border-muted-foreground/25 hover:border-muted-foreground/50"
        }
        ${isCopying ? "opacity-50 pointer-events-none" : ""}
      `}
    >
      <Upload className="h-4 w-4 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">
        {isCopying
          ? "Copying..."
          : status
          ? status.message
          : "Drop files here"}
      </span>
      {status && (
        <span
          className={`text-xs ${
            status.type === "success" ? "text-green-600" : "text-red-600"
          }`}
        >
          {status.type === "success" ? "✓" : "✗"}
        </span>
      )}
    </div>
  );
}
