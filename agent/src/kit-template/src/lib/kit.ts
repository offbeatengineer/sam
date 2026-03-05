const API_PREFIX = `${import.meta.env.BASE_URL}api`;

type KitMenuItem = { id: string; label: string; systemImage?: string };
type MenuActionCallback = (actionId: string) => void;

function postNative(message: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).webkit?.messageHandlers?.samKit?.postMessage(message);
  } catch {
    /* not in native webview context */
  }
}

/** Fetch wrapper that routes to this kit's backend.
 *  Use the same paths as your Hono routes:
 *    kit.fetch("/todos")  →  GET /todos on the backend
 */
export const kit = {
  fetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${API_PREFIX}${path}`, init);
  },

  /** Set the native nav bar title (iOS only, no-op elsewhere). */
  setTitle(title: string): void {
    postNative({ type: "setTitle", title });
  },

  /** Configure a native dropdown menu in the nav bar (iOS only, no-op elsewhere). */
  setMenu(items: KitMenuItem[]): void {
    postNative({ type: "setMenu", items });
  },

  /** Register a callback for when a native menu item is tapped. */
  onMenuAction(callback: MenuActionCallback): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__kitMenuCallback = callback;
  },
};
