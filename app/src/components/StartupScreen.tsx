import { useCallback, useEffect, useState } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { requestNotificationPermission } from "@/lib/notifications";
import { connectToSam } from "@/lib/tauri";

interface StartupScreenProps {
  onComplete: () => void;
}

export function StartupScreen({ onComplete }: StartupScreenProps) {
  const [status, setStatus] = useState("Starting...");

  const loadSessions = useSessionStore((state) => state.loadSessions);
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  const handleComplete = useCallback(onComplete, [onComplete]);

  useEffect(() => {
    async function init() {
      try {
        // Step 1: Load settings
        setStatus("Loading settings...");
        await loadSettings();

        // Step 2: Connect to sam
        setStatus("Connecting to sam...");
        const samUrl = useSettingsStore.getState().samUrl;
        try {
          await connectToSam(samUrl);
        } catch (err) {
          console.warn("Failed to connect to sam:", err);
        }

        // Step 3: Start connection status polling
        useSettingsStore.getState().startConnectionPolling();

        // Step 4: Load sessions from agent
        setStatus("Loading sessions...");
        try {
          await loadSessions();
        } catch (err) {
          console.warn("Failed to load sessions:", err);
        }

        // Step 5: Auto-select most recently modified session
        const { sessions, selectSession } = useSessionStore.getState();
        if (sessions.length > 0) {
          const mostRecent = sessions[0]; // already sorted by modified desc
          selectSession(`${mostRecent.channelId}:${mostRecent.conversationId}`);
        }

        // Step 6: Background tasks
        requestNotificationPermission();

        handleComplete();
      } catch (err) {
        console.error("Startup failed:", err);
        handleComplete();
      }
    }

    init();
  }, [loadSessions, loadSettings, handleComplete]);

  return (
    <div className="flex items-center justify-center h-screen bg-sidebar">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Sam</h1>
        <p className="text-muted-foreground mb-2">{status}</p>
      </div>
    </div>
  );
}
