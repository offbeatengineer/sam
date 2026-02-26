import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";
import { connectToSam, disconnectFromSam, isConnected } from "@/lib/tauri";

export function SettingsDialog() {
  const {
    settingsDialogOpen,
    closeSettingsDialog,
    samUrl,
    setSamUrl,
  } = useSettingsStore();

  const [urlInput, setUrlInput] = useState(samUrl);
  const [connectionStatus, setConnectionStatus] = useState<"unknown" | "connected" | "disconnected" | "connecting">("unknown");

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

  const handleCheckStatus = async () => {
    try {
      const connected = await isConnected();
      setConnectionStatus(connected ? "connected" : "disconnected");
    } catch {
      setConnectionStatus("disconnected");
    }
  };

  return (
    <Dialog open={settingsDialogOpen} onOpenChange={(open) => {
      if (!open) closeSettingsDialog();
      else handleCheckStatus();
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your connection to sam.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Sam Connection */}
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

        <DialogFooter>
          <Button variant="outline" onClick={closeSettingsDialog}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
