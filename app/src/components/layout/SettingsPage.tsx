import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";
import { connectToSam, disconnectFromSam, isConnected } from "@/lib/tauri";

export function SettingsPage() {
  const { samUrl, setSamUrl } = useSettingsStore();
  const [urlInput, setUrlInput] = useState(samUrl);
  const [connectionStatus, setConnectionStatus] = useState<
    "unknown" | "connected" | "disconnected" | "connecting"
  >("unknown");

  useEffect(() => {
    isConnected()
      .then((connected) =>
        setConnectionStatus(connected ? "connected" : "disconnected")
      )
      .catch(() => setConnectionStatus("disconnected"));
  }, []);

  const handleConnect = async () => {
    setConnectionStatus("connecting");
    try {
      await connectToSam(urlInput);
      setSamUrl(urlInput);
      setConnectionStatus("connected");
    } catch (error) {
      console.error("Failed to connect:", error);
      setConnectionStatus("disconnected");
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectFromSam();
      setConnectionStatus("disconnected");
    } catch (error) {
      console.error("Failed to disconnect:", error);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      <div data-tauri-drag-region className="flex items-center h-12 px-4 border-b border-border shrink-0">
        <h2 className="text-sm font-medium">Settings</h2>
      </div>
      <div className="flex-1 flex items-start justify-center p-8 overflow-auto">
        <div className="w-full max-w-md space-y-6">
          <p className="text-sm text-muted-foreground">
            Configure your connection to sam.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Sam URL</label>
            <p className="text-xs text-muted-foreground">
              WebSocket URL of the running sam instance.
            </p>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm"
              placeholder="ws://127.0.0.1:9222"
            />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleConnect}
                disabled={connectionStatus === "connecting"}
              >
                {connectionStatus === "connecting" ? "Connecting..." : "Connect"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
              >
                Disconnect
              </Button>
              {connectionStatus === "connected" && (
                <span className="text-xs text-green-600">Connected</span>
              )}
              {connectionStatus === "disconnected" && (
                <span className="text-xs text-red-500">Disconnected</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
