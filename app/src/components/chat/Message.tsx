import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message as MessageType, ContentBlock } from "@/types/chat";
import { ThinkingDisplay } from "./ThinkingDisplay";

interface MessageProps {
  message: MessageType;
}

function renderContentBlocks(blocks: ContentBlock[]) {
  return blocks.map((block, index) => {
    if (block.type === "thinking") {
      return (
        <ThinkingDisplay
          key={`block-${index}`}
          thinking={{ content: block.content, isComplete: block.isComplete }}
        />
      );
    }
    if (block.type === "text" && block.content) {
      return (
        <div
          key={`block-${index}`}
          className="prose prose-neutral dark:prose-invert max-w-none text-sm [&_pre]:overflow-x-auto"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {block.content}
          </ReactMarkdown>
        </div>
      );
    }
    return null;
  });
}

export function Message({ message }: MessageProps) {
  const isUser = message.role === "user";

  if (isUser) {
    // User messages: keep existing bubble styling
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl px-4 py-2 bg-primary text-primary-foreground">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  // Check if we have contentBlocks (new format)
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;

  // Assistant with contentBlocks: render blocks in order
  if (hasContentBlocks) {
    return (
      <div className="w-full">
        {renderContentBlocks(message.contentBlocks!)}
      </div>
    );
  }

  // Fallback for old messages without contentBlocks: use legacy thinking + content
  return (
    <div className="w-full">
      {/* Show thinking block if present (legacy format) */}
      {message.thinking && <ThinkingDisplay thinking={message.thinking} />}
      <div className="prose prose-neutral dark:prose-invert max-w-none text-sm [&_pre]:overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
