import {
  FileText,
  Globe,
  Terminal,
  AlertTriangle,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ToolExecution } from "@/types/chat";

interface ToolCardProps {
  tool: ToolExecution;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPrev?: () => void;
  onNext?: () => void;
}

const toolIcons: Record<string, React.ElementType> = {
  "Fetching URL": Globe,
  "Reading file": FileText,
  "Get page text": FileText,
  "Tabs Context": Terminal,
  default: Terminal,
};

export function ToolCard({ tool, isOpen, onOpenChange, onPrev, onNext }: ToolCardProps) {
  const Icon = toolIcons[tool.name] || toolIcons.default;

  const statusIcon = {
    pending: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
    running: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
    success: <Check className="h-4 w-4 text-green-600" />,
    warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    error: <AlertTriangle className="h-4 w-4 text-destructive" />,
  };

  const hasDetails = tool.details || tool.input || tool.output;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button className="w-full border border-border rounded-lg bg-card overflow-hidden flex items-center gap-3 px-4 py-2 hover:bg-accent/50 transition-colors text-left">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="flex-1 min-w-0 text-sm truncate">{tool.name}</span>
          {statusIcon[tool.status]}
        </button>
      </DialogTrigger>
      {hasDetails && (
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-muted-foreground" />
              {tool.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 min-w-0 overflow-hidden">
            {tool.details && (
              <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono">
                {tool.details}
              </pre>
            )}
            {tool.input && (
              <div className="min-w-0">
                <div className="text-sm font-medium text-muted-foreground mb-2">Input</div>
                <pre className="text-sm whitespace-pre font-mono bg-muted/50 p-3 rounded max-h-96 overflow-auto">
                  {JSON.stringify(tool.input, null, 2)}
                </pre>
              </div>
            )}
            {tool.output && (
              <div className="min-w-0">
                <div className="text-sm font-medium text-muted-foreground mb-2">Output</div>
                <pre className="text-sm whitespace-pre font-mono bg-muted/50 p-3 rounded max-h-96 overflow-auto">
                  {tool.output}
                </pre>
              </div>
            )}
          </div>
          {(onPrev || onNext) && (
            <div className="flex justify-between pt-4 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={onPrev}
                disabled={!onPrev}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onNext}
                disabled={!onNext}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
