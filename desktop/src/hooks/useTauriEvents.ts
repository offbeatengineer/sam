import { useEffect, useRef } from "react";
import { onAppResponse, type AppResponseHandler } from "@/lib/tauri";
import type { UnlistenFn } from "@tauri-apps/api/event";

/**
 * Hook to listen for app response events from sam via Tauri WebSocket
 * Handles React StrictMode's double-invocation of effects
 */
export function useTauriEvents(handler: AppResponseHandler) {
  // Use a ref to store the handler to avoid recreating the listener on every render
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let isCleanedUp = false;
    let unlisten: UnlistenFn | null = null;

    const wrappedHandler: AppResponseHandler = (response) => {
      handlerRef.current(response);
    };

    onAppResponse(wrappedHandler).then((unlistenFn) => {
      if (isCleanedUp) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    });

    return () => {
      isCleanedUp = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);
}
