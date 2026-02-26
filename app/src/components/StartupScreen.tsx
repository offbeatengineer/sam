import { useCallback, useEffect, useState } from "react";
import { migrateConversations } from "@/lib/storage";
import { useTaskStore } from "@/stores/taskStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { requestNotificationPermission } from "@/lib/notifications";
import { connectToSam } from "@/lib/tauri";

interface StartupScreenProps {
  onComplete: () => void;
}

export function StartupScreen({ onComplete }: StartupScreenProps) {
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [status, setStatus] = useState("Starting...");

  const initializeApp = useTaskStore((state) => state.initializeApp);
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  const handleComplete = useCallback(onComplete, [onComplete]);

  useEffect(() => {
    async function init() {
      try {
        // Step 1: Migrate conversations to new format
        setStatus("Migrating conversations...");
        await migrateConversations((current, total) => {
          setProgress({ current, total });
        });

        // Step 2: Load settings
        setStatus("Loading settings...");
        await loadSettings();

        // Step 3: Initialize app (load tasks)
        setStatus("Loading tasks...");
        await initializeApp();

        // Step 4: Connect to sam
        setStatus("Connecting to sam...");
        const samUrl = useSettingsStore.getState().samUrl;
        try {
          await connectToSam(samUrl);
        } catch (err) {
          console.warn("Failed to connect to sam:", err);
          // Don't block startup — user can reconnect later
        }

        // Step 5: Start connection status polling
        useSettingsStore.getState().startConnectionPolling();

        // Step 6: Background tasks
        requestNotificationPermission();

        // Done
        handleComplete();
      } catch (err) {
        console.error("Startup failed:", err);
        handleComplete();
      }
    }

    init();
  }, [initializeApp, loadSettings, handleComplete]);

  return (
    <div className="flex items-center justify-center h-screen bg-sidebar">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Sam</h1>
        <p className="text-muted-foreground mb-2">{status}</p>
        {progress.total > 0 && (
          <p className="text-sm text-muted-foreground">
            {progress.current} / {progress.total}
          </p>
        )}
      </div>
    </div>
  );
}
