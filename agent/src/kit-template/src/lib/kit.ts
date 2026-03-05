const API_PREFIX = `${import.meta.env.BASE_URL}api`;

/** Fetch wrapper that routes to this kit's backend.
 *  Use the same paths as your Hono routes:
 *    kit.fetch("/todos")  →  GET /todos on the backend
 */
export const kit = {
  fetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${API_PREFIX}${path}`, init);
  },
};
