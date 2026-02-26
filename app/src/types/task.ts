export interface Task {
  id: string;
  title: string;
  sessionId?: string;
  workingDirectory?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProgressItem {
  id: string;
  label: string;
  completed: boolean;
}

export interface Artifact {
  id: string;
  name: string;
  type: "file" | "image" | "chart" | "other";
  path?: string;
}

export interface TaskContext {
  folders: string[];
  connectors: Connector[];
  workingFiles: string[];
}

export interface Connector {
  id: string;
  name: string;
  icon?: string;
  connected: boolean;
}
