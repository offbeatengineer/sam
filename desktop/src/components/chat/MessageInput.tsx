import { useRef, useEffect, useLayoutEffect, useCallback, useState } from "react";
import { ArrowUp, Square, ImagePlus, Mic, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSessionStore, useActiveStreaming } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useInputStore, type PendingAudio } from "@/stores/inputStore";
import { sendChat, abortTurn } from "@/lib/tauri";
import { uploadFile } from "@/lib/upload";
import type { ChatAttachment } from "@/types/chat";

export function MessageInput() {
  const { input, setInput, setTextareaRef, pendingImages, pendingAudio, isRecording, addImages, removeImage, removePendingAudio, clearAttachments, hasAttachments, setRecording, setPendingAudio } = useInputStore();
  const maxHeight = 15 * 21 + 8;
  const [scrollState, setScrollState] = useState({ thumbHeight: 0, thumbTop: 0, showScrollbar: false });
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isStreaming = useActiveStreaming();

  useEffect(() => {
    setTextareaRef(textareaRef);
  }, [setTextareaRef]);

  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const setInputHeight = useUIStore((state) => state.setInputHeight);
  const containerRef = useRef<HTMLDivElement>(null);

  const updateScrollbar = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollHeight, clientHeight, scrollTop } = container;
    const hasOverflow = scrollHeight > clientHeight;
    if (hasOverflow) {
      const thumbHeight = Math.max(30, (clientHeight / scrollHeight) * clientHeight);
      const scrollableHeight = scrollHeight - clientHeight;
      const thumbRange = clientHeight - thumbHeight;
      const thumbTop = scrollableHeight > 0 ? (scrollTop / scrollableHeight) * thumbRange : 0;
      setScrollState({ thumbHeight, thumbTop, showScrollbar: true });
    } else {
      setScrollState({ thumbHeight: 0, thumbTop: 0, showScrollbar: false });
    }
  }, []);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [input]);

  useLayoutEffect(() => {
    updateScrollbar();
  }, [input, updateScrollbar]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("scroll", updateScrollbar);
    return () => container.removeEventListener("scroll", updateScrollbar);
  }, [updateScrollbar]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const height = container.offsetHeight;
      setInputHeight(height + 16);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [setInputHeight]);

  const handleImageFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length > 0) {
      addImages(imageFiles);
    }
  }, [addImages]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        e.preventDefault();
        addImages(imageFiles);
      }
    }
  }, [addImages]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (files) {
      handleImageFiles(files);
    }
  }, [handleImageFiles]);

  const startRecording = useCallback(async () => {
    try {
      await invoke("start_recording");
      setRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  }, [setRecording]);

  const stopRecording = useCallback(async () => {
    try {
      const result = await invoke<{ path: string; duration: number; mimeType: string }>("stop_recording");
      setRecording(false);
      // Read the WAV file from disk to create a Blob for upload
      const bytes = await readFile(result.path);
      const blob = new Blob([bytes], { type: result.mimeType });
      const audio: PendingAudio = {
        id: crypto.randomUUID(),
        blob,
        duration: result.duration,
        mimeType: result.mimeType,
      };
      setPendingAudio(audio);
    } catch (err) {
      setRecording(false);
      console.error("Failed to stop recording:", err);
    }
  }, [setPendingAudio, setRecording]);

  const handleSubmit = async () => {
    const hasText = input.trim().length > 0;
    const hasAtt = hasAttachments();
    if ((!hasText && !hasAtt) || isStreaming) return;

    const messageContent = input.trim();
    const images = [...pendingImages];
    const audio = pendingAudio;

    // Clear input + attachments immediately
    setInput("");
    clearAttachments();

    const store = useSessionStore.getState();
    store.setPendingUserMessage(
      messageContent,
      images.map((img) => ({ id: img.id, dataUrl: img.dataUrl })),
      audio ? { duration: audio.duration } : null,
    );

    // Get or create a conversationId
    let conversationId: string;
    if (activeSessionId) {
      const parts = activeSessionId.split(":");
      conversationId = parts.slice(1).join(":");
    } else {
      conversationId = store.createNewSession();
    }

    try {
      // Upload attachments
      const attachments: ChatAttachment[] = [];

      for (const img of images) {
        const result = await uploadFile(img.resizedBlob, "image/jpeg");
        attachments.push({ type: "image", path: result.path, mimeType: result.mimeType });
      }

      if (audio) {
        const result = await uploadFile(audio.blob, audio.mimeType);
        attachments.push({ type: "audio", path: result.path, mimeType: result.mimeType });
      }

      await sendChat(
        conversationId,
        messageContent,
        attachments.length > 0 ? attachments : undefined,
      );
    } catch (error) {
      console.error("Failed to send chat:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleStop = async () => {
    if (!activeSessionId) return;
    const parts = activeSessionId.split(":");
    const conversationId = parts.slice(1).join(":");
    try {
      await abortTurn(conversationId);
    } catch (error) {
      console.error("Failed to abort turn:", error);
    }
  };

  const hasPreview = pendingImages.length > 0 || pendingAudio !== null;

  return (
    <div
      ref={containerRef}
      className={cn("absolute bottom-4 left-0 right-0 z-10 px-6", isDragOver && "opacity-80")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="max-w-3xl mx-auto rounded-md p-3 shadow-[0_0_10px_rgba(0,0,0,0.15)]">
        {/* Attachment previews */}
        {hasPreview && (
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {pendingImages.map((img) => (
              <div key={img.id} className="relative group">
                <img
                  src={img.dataUrl}
                  alt="attachment"
                  className="h-[60px] w-[60px] rounded-lg object-cover"
                />
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {pendingAudio && (
              <div className="flex items-center gap-1.5 bg-muted rounded-full px-3 py-1.5 text-xs">
                <Mic className="h-3 w-3" />
                <span>{formatDuration(pendingAudio.duration)}</span>
                <button onClick={removePendingAudio} className="ml-1 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        )}

        <div className="relative w-full">
          <div
            ref={scrollContainerRef}
            className="overflow-y-auto hide-native-scrollbar"
            style={{ maxHeight: `${maxHeight}px` }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={isRecording ? "Recording..." : "Reply..."}
              className="w-full bg-transparent border-none outline-none resize-none text-sm min-h-[24px] py-1 pr-3"
              rows={1}
              disabled={isStreaming || isRecording}
            />
          </div>
          {scrollState.showScrollbar && (
            <div className="absolute right-0 top-0 w-2 h-full p-[1px] pointer-events-none">
              <div
                className="w-full rounded-full bg-neutral-400 hover:bg-neutral-500 transition-colors"
                style={{
                  height: `${scrollState.thumbHeight}px`,
                  transform: `translateY(${scrollState.thumbTop}px)`,
                }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleImageFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              title="Attach image"
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "shrink-0 h-8 w-8 transition-colors",
                isRecording && "bg-destructive/15 text-destructive hover:bg-destructive/25",
              )}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isStreaming}
              title={isRecording ? "Stop recording" : "Record audio"}
            >
              <Mic className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {isStreaming ? (
              <Button
                size="icon"
                variant="destructive"
                className="shrink-0 h-8 w-8 rounded-full"
                onClick={handleStop}
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="shrink-0 h-8 w-8 rounded-full"
                onClick={handleSubmit}
                disabled={!input.trim() && !hasAttachments()}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
