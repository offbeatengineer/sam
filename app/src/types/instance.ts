export interface BackendInstance {
  id: string;
  name: string;
  serverUrl: string;
  apiKey?: string;
}

export function deriveArtifactsUrl(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    const protocol = url.protocol === "wss:" ? "https:" : "http:";
    return `${protocol}//${url.host}`;
  } catch {
    return "http://127.0.0.1:9222";
  }
}

export function buildConnectionUrl(instance: BackendInstance): string {
  if (instance.apiKey) {
    const sep = instance.serverUrl.includes("?") ? "&" : "?";
    return `${instance.serverUrl}${sep}apiKey=${instance.apiKey}`;
  }
  return instance.serverUrl;
}

export function createInstance(
  name: string,
  serverUrl: string,
  apiKey?: string,
): BackendInstance {
  return {
    id: crypto.randomUUID(),
    name,
    serverUrl,
    apiKey: apiKey || undefined,
  };
}
