import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useTaskStore } from "@/stores/taskStore";
import { DirectoryTree } from "./DirectoryTree";
import { FileDropzone } from "./FileDropzone";

export function ContextSection() {
  const activeTask = useTaskStore((state) => {
    const task = state.tasks.find((t) => t.id === state.activeTaskId);
    return task;
  });

  const workingDirectory = activeTask?.workingDirectory;

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
