const API_PREFIX = `${import.meta.env.BASE_URL}api`;

type KitMenuItem = { id: string; label: string; systemImage?: string; icon?: string };
type MenuActionCallback = (actionId: string) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isNativeWebView = !!(window as any).webkit?.messageHandlers?.samKit;
const isIframe = window.parent !== window;

function postBridge(message: Record<string, unknown>): void {
  if (isNativeWebView) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkit.messageHandlers.samKit.postMessage(message);
    } catch { /* not available */ }
  } else if (isIframe) {
    window.parent.postMessage({ source: "sam-kit", ...message }, "*");
  }
}

// Listen for menu action callbacks from the desktop parent frame
if (isIframe) {
  window.addEventListener("message", (event) => {
    if (event.data?.source === "sam-kit-host" && event.data?.type === "menuAction") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__kitMenuCallback?.(event.data.actionId);
    }
  });
}

/** Fetch wrapper that routes to this kit's backend.
 *  Use the same paths as your Hono routes:
 *    kit.fetch("/todos")  →  GET /todos on the backend
 */
export const kit = {
  fetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${API_PREFIX}${path}`, init);
  },

  /** Set the header title (works on both iOS and desktop). */
  setTitle(title: string): void {
    postBridge({ type: "setTitle", title });
  },

  /** Configure menu items in the header bar (works on both iOS and desktop). */
  setMenu(items: KitMenuItem[]): void {
    postBridge({ type: "setMenu", items });
  },

  /** Register a callback for when a menu item is activated. */
  onMenuAction(callback: MenuActionCallback): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__kitMenuCallback = callback;
  },
};
