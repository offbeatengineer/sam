import { TaskItem } from "./TaskItem";
import { useTaskStore } from "@/stores/taskStore";

export function TaskList() {
  const { tasks, activeTaskId, switchTask } = useTaskStore();

  const handleTaskClick = (taskId: string) => {
    switchTask(taskId);
  };

  if (tasks.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No tasks yet. Click "New task" to get started.
      </div>
    );
  }

  return (
    <div className="pb-2 w-64">
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          isActive={task.id === activeTaskId}
          onClick={() => handleTaskClick(task.id)}
        />
      ))}
    </div>
  );
}
