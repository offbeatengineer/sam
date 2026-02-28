import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useSessionStore } from "@/stores/sessionStore";
import { DirectoryTree } from "./DirectoryTree";
import { FileDropzone } from "./FileDropzone";

export function ContextSection() {
  const activeHeader = useSessionStore((state) => state.activeHeader);
  const activeSession = useSessionStore((state) => state.getActiveSession());

  const workingDirectory = activeHeader?.cwd ?? activeSession?.cwd;

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="text-sm font-medium">
        Files
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3">
          {workingDirectory ? (
            <>
              <DirectoryTree rootPath={workingDirectory} />
              <FileDropzone workingDirectory={workingDirectory} />
            </>
          ) : (
            <div className="text-xs text-muted-foreground py-2">
              No working directory set
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
