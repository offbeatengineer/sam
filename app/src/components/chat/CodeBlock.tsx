import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  content: string;
  language?: string;
  showMore?: boolean;
}

export function CodeBlock({ content, language, showMore = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(!showMore);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayContent = expanded ? content : content.slice(0, 500);
  const needsTruncation = showMore && content.length > 500;

  return (
    <div className="relative rounded-lg bg-card border border-border overflow-hidden my-3">
      {language && (
        <div className="px-4 py-2 border-b border-border bg-card/50 text-xs text-muted-foreground">
          {language}
        </div>
      )}

      <div className="relative">
        <pre
          className={cn(
            "p-4 text-sm font-mono overflow-x-auto",
            !expanded && needsTruncation && "max-h-32 overflow-hidden"
          )}
        >
          <code>{displayContent}</code>
        </pre>

        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 p-2 rounded-md bg-card hover:bg-accent transition-colors"
          title="Copy code"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            <Copy className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>

      {needsTruncation && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full py-2 text-sm text-primary hover:underline border-t border-border"
        >
          Show more
        </button>
      )}
    </div>
  );
}
