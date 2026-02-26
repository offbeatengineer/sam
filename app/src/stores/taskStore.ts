import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import {
  saveTasks,
  loadTasks,
  deleteTaskFolder,
} from "@/lib/storage";
import type { Task } from "@/types/task";

interface TaskStore {
  tasks: Task[];
  activeTaskId: string | null;
  isLoaded: boolean;

  initializeApp: () => Promise<void>;
  switchTask: (taskId: string) => Promise<void>;
  createNewTask: (title: string, workingDirectory?: string) => Task;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => Promise<void>;
  getActiveTask: () => Task | undefined;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export const useTaskStore = create<TaskStore>()(
  subscribeWithSelector((set, get) => ({
    tasks: [],
    activeTaskId: null,
    isLoaded: false,

    initializeApp: async () => {
      const tasks = await loadTasks();
      const firstTaskId = tasks[0]?.id ?? null;
      set({ tasks, isLoaded: true, activeTaskId: firstTaskId });
    },

    switchTask: async (taskId: string) => {
      const { activeTaskId } = get();
      if (taskId === activeTaskId) return;
      set({ activeTaskId: taskId });
    },

    createNewTask: (title: string, workingDirectory?: string) => {
      const newTask: Task = {
        id: generateId(),
        title,
        workingDirectory,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      set((state) => ({
        tasks: [newTask, ...state.tasks],
        activeTaskId: newTask.id,
      }));

      return newTask;
    },

    updateTask: (id, updates) =>
      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === id
            ? { ...task, ...updates, updatedAt: new Date() }
            : task
        ),
      })),

    deleteTask: async (id: string) => {
      const { activeTaskId, tasks } = get();

      // Delete task folder from disk
      await deleteTaskFolder(id).catch(console.error);

      const newTasks = tasks.filter((task) => task.id !== id);
      const wasActive = activeTaskId === id;
      const newActiveId = wasActive
        ? newTasks.length > 0
          ? newTasks[0].id
          : null
        : activeTaskId;

      set({ tasks: newTasks, activeTaskId: newActiveId });
    },

    getActiveTask: () => {
      const state = get();
      return state.tasks.find((task) => task.id === state.activeTaskId);
    },
  }))
);

// Auto-save tasks when they change (after initial load)
useTaskStore.subscribe(
  (state) => state.tasks,
  (tasks) => {
    if (useTaskStore.getState().isLoaded) {
      saveTasks(tasks);
    }
  }
);
