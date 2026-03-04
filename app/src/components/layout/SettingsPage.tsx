import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useSettingsStore } from "@/stores/settingsStore";
import type { BackendInstance } from "@/types/instance";
import { Plus, Pencil, Trash2, Check, Eye, EyeOff } from "lucide-react";

// ============ Instance Dialog ============

interface InstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instance: BackendInstance | null; // null = add mode
  onSave: (name: string, serverUrl: string, apiKey?: string) => void;
}

function InstanceDialog({ open, onOpenChange, instance, onSave }: InstanceDialogProps) {
  const [name, setName] = useState(instance?.name ?? "");
  const [serverUrl, setServerUrl] = useState(instance?.serverUrl ?? "");
  const [apiKey, setApiKey] = useState(instance?.apiKey ?? "");
  const [showApiKey, setShowApiKey] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      // Reset form on open
      setName(instance?.name ?? "");
      setServerUrl(instance?.serverUrl ?? "");
      setApiKey(instance?.apiKey ?? "");
      setShowApiKey(false);
    }
    onOpenChange(nextOpen);
  };

  const handleSave = () => {
    if (!name.trim() || !serverUrl.trim()) return;
    onSave(name.trim(), serverUrl.trim(), apiKey.trim() || undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{instance ? "Edit Instance" : "Add Instance"}</DialogTitle>
          <DialogDescription>
            {instance
              ? "Update the backend instance configuration."
              : "Add a new sam backend instance to connect to."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm"
              placeholder="e.g. Local, Production"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Server URL</label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm"
              placeholder="ws://127.0.0.1:9222"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-3 py-2 pr-10 rounded-md border border-border bg-muted/30 text-sm"
                placeholder="Optional"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!name.trim() || !serverUrl.trim()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Settings Page ============

export function SettingsPage() {
  const { instances, activeInstanceId, addInstance, updateInstance, removeInstance, switchInstance } =
    useSettingsStore();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInstance, setEditingInstance] = useState<BackendInstance | null>(null);

  const handleAdd = () => {
    setEditingInstance(null);
    setDialogOpen(true);
  };

  const handleEdit = (instance: BackendInstance) => {
    setEditingInstance(instance);
    setDialogOpen(true);
  };

  const handleSave = async (name: string, serverUrl: string, apiKey?: string) => {
    if (editingInstance) {
      await updateInstance(editingInstance.id, { name, serverUrl, apiKey });
    } else {
      await addInstance(name, serverUrl, apiKey);
    }
  };

  const handleDelete = async (id: string) => {
    await removeInstance(id);
  };

  const handleActivate = async (id: string) => {
    if (id !== activeInstanceId) {
      await switchInstance(id);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      <div
        data-tauri-drag-region
        className="flex items-center justify-center h-12 px-4 border-b border-border shrink-0"
      >
        <h2 className="text-sm font-medium">Settings</h2>
      </div>
      <div className="flex-1 flex items-start justify-center p-8 overflow-auto">
        <div className="w-full max-w-md space-y-6">
          {/* Backend Instances */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Backend Instances</h3>
              <Button variant="outline" size="sm" onClick={handleAdd}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage your sam backend connections. Click a row to activate it.
            </p>

            {instances.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground mb-3">
                  No instances configured yet.
                </p>
                <Button variant="outline" size="sm" onClick={handleAdd}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add your first instance
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {instances.map((instance) => {
                  const isActive = instance.id === activeInstanceId;
                  return (
                    <div
                      key={instance.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                        isActive
                          ? "bg-accent/50 border border-border"
                          : "hover:bg-accent/30 border border-transparent"
                      }`}
                      onClick={() => handleActivate(instance.id)}
                    >
                      <div className="w-4 flex-shrink-0">
                        {isActive && <Check className="h-4 w-4 text-green-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{instance.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {instance.serverUrl}
                          {instance.apiKey && " (API key set)"}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(instance);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(instance.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <InstanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        instance={editingInstance}
        onSave={handleSave}
      />
    </div>
  );
}
