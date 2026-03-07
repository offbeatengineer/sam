import { useSettingsStore } from "@/stores/settingsStore";

export function buildUploadUrl(path: string): string {
  const { artifactsUrl } = useSettingsStore.getState();
  const instance = useSettingsStore.getState().getActiveInstance();
  const apiKey = instance?.apiKey;
  const url = `${artifactsUrl}${path}`;
  if (apiKey) {
    return `${url}?apiKey=${encodeURIComponent(apiKey)}`;
  }
  return url;
}
