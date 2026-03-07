import { Package } from "lucide-react";

interface KitManifest {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  version?: string;
  enabled?: boolean;
}

interface KitCreateCardProps {
  details: { action: string; manifest: KitManifest };
}

export function KitCreateCard({ details }: KitCreateCardProps) {
  const { manifest } = details;

  return (
    <div className="w-full rounded-lg border border-blue-500/20 bg-blue-500/5 overflow-hidden">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <Package className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">Kit created</p>
          <p className="text-sm font-medium mt-0.5">{manifest.name}</p>
          {manifest.description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {manifest.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
            <span>{manifest.id}</span>
            {manifest.version && <span>v{manifest.version}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
