import { Globe, ExternalLink, FileText } from "lucide-react";

interface WebFetchDetails {
  url: string;
  title: string;
  description?: string;
  siteName?: string;
  image?: string;
  favicon?: string;
  contentLength: number;
  truncated: boolean;
}

interface WebFetchCardProps {
  details: WebFetchDetails;
}

function openUrl(url: string) {
  window.open(url, "_blank");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} chars`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K chars`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M chars`;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function WebFetchCard({ details }: WebFetchCardProps) {
  return (
    <button
      onClick={() => openUrl(details.url)}
      className="w-full rounded-lg border border-border bg-card overflow-hidden hover:bg-accent/30 transition-colors text-left"
    >
      <div className="flex items-stretch">
        {/* OG Image on left */}
        {details.image && (
          <div className="w-32 shrink-0 overflow-hidden border-r border-border">
            <img
              src={details.image}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).parentElement!.style.display = "none";
              }}
            />
          </div>
        )}

        <div className="min-w-0 flex-1 px-3 py-2.5">
          {/* Site info row */}
          <div className="flex items-center gap-1.5 mb-1">
            {details.favicon ? (
              <img
                src={details.favicon}
                alt=""
                className="h-4 w-4 rounded-sm shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className="text-[11px] text-muted-foreground/70 truncate">
              {details.siteName || hostFromUrl(details.url)}
            </span>
            <ExternalLink className="h-3 w-3 text-muted-foreground/50 shrink-0 ml-auto" />
          </div>

          {/* Title */}
          <p className="text-sm font-medium truncate mb-0.5">
            {details.title || hostFromUrl(details.url)}
          </p>

          {/* Description */}
          {details.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-1.5">
              {details.description}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
            <FileText className="h-3 w-3" />
            <span>{formatBytes(details.contentLength)}</span>
            {details.truncated && (
              <span className="px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                truncated
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
