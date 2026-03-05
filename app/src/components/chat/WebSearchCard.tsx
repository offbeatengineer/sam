import { Search, Globe, ExternalLink } from "lucide-react";

interface SearchResultItem {
  title: string;
  url: string;
  description: string;
  favicon?: string;
  thumbnail?: string;
  age?: string;
  siteName?: string;
}

interface WebSearchDetails {
  query: string;
  provider: string;
  results: SearchResultItem[];
}

interface WebSearchCardProps {
  details: WebSearchDetails;
}

function openUrl(url: string) {
  window.open(url, "_blank");
}

function FaviconImg({ src, alt }: { src?: string; alt: string }) {
  if (!src) return <Globe className="h-4 w-4 text-muted-foreground shrink-0" />;
  return (
    <img
      src={src}
      alt={alt}
      className="h-4 w-4 rounded-sm shrink-0"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

export function WebSearchCard({ details }: WebSearchCardProps) {
  return (
    <div className="w-full rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium truncate flex-1">{details.query}</span>
        <span className="text-[10px] text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted">
          {details.provider}
        </span>
      </div>

      {/* Results */}
      <div className="divide-y divide-border">
        {details.results.map((result, i) => (
          <button
            key={i}
            onClick={() => openUrl(result.url)}
            className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-accent/50 transition-colors text-left"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <FaviconImg src={result.favicon} alt={result.title} />
                <span className="text-sm font-medium text-primary truncate">
                  {result.title}
                </span>
                <ExternalLink className="h-3 w-3 text-muted-foreground/50 shrink-0" />
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 mb-0.5">
                {result.siteName && <span>{result.siteName}</span>}
                {result.siteName && result.age && <span>·</span>}
                {result.age && <span>{result.age}</span>}
              </div>
              {result.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {result.description}
                </p>
              )}
            </div>
            {result.thumbnail && (
              <img
                src={result.thumbnail}
                alt=""
                className="w-16 h-12 object-cover rounded shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
