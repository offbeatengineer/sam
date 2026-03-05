import { useEffect } from "react";
import {
  Package, ExternalLink, Power, PowerOff, Sparkles, Calculator, Calendar, Camera,
  BarChart3, LineChart, PieChart, ListChecks, Clock, Cloud, Code, Coins, Compass,
  Database, FileText, Folder, Gamepad2, Globe, GraduationCap, Heart, Home, Image,
  Inbox, Key, Layers, Lightbulb, Link, List, Mail, Map, Megaphone, MessageCircle,
  Mic, Music, NotebookPen, Palette, Pen, Pizza, Plane, Puzzle, Receipt, Rocket,
  Search, Shield, ShoppingCart, Star, Sun, Tag, Timer, Trophy, Users, Wallet, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";
import { useKitsStore, type KitInfo } from "@/stores/kitsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, LucideIcon> = {
  box: Package, sparkles: Sparkles, calculator: Calculator, calendar: Calendar,
  camera: Camera, "chart-bar": BarChart3, "chart-line": LineChart, "chart-pie": PieChart,
  "check-list": ListChecks, clock: Clock, cloud: Cloud, code: Code, coins: Coins,
  compass: Compass, database: Database, "file-text": FileText, folder: Folder,
  gamepad: Gamepad2, globe: Globe, "graduation-cap": GraduationCap, heart: Heart,
  home: Home, image: Image, inbox: Inbox, key: Key, layers: Layers, lightbulb: Lightbulb,
  link: Link, list: List, mail: Mail, map: Map, megaphone: Megaphone, message: MessageCircle,
  mic: Mic, music: Music, notebook: NotebookPen, palette: Palette, pen: Pen, pizza: Pizza,
  plane: Plane, puzzle: Puzzle, receipt: Receipt, rocket: Rocket, search: Search,
  shield: Shield, "shopping-cart": ShoppingCart, star: Star, sun: Sun, tag: Tag,
  timer: Timer, trophy: Trophy, users: Users, wallet: Wallet, wrench: Wrench, zap: Zap,
};

function getKitIcon(icon: string) {
  const Icon = ICON_MAP[icon] ?? Package;
  return <Icon className="h-5 w-5 text-blue-500" />;
}

export function KitsPage() {
  const kits = useKitsStore((s) => s.kits);
  const isLoading = useKitsStore((s) => s.isLoading);
  const fetchKits = useKitsStore((s) => s.fetchKits);
  const selectedKitId = useKitsStore((s) => s.selectedKitId);
  const setSelectedKitId = useKitsStore((s) => s.setSelectedKitId);

  useEffect(() => {
    fetchKits();
  }, [fetchKits]);

  const selectedKit = kits.find((k) => k.id === selectedKitId) ?? null;

  return (
    <div className="flex flex-1 min-w-0">
      {/* Left column — kit list */}
      <div className="w-72 shrink-0 flex flex-col overflow-hidden bg-sidebar border-r border-sidebar-border">
        <div data-tauri-drag-region className="flex items-center justify-center h-12 px-3 border-b border-border">
          <h2 className="text-sm font-medium">Kits</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            {isLoading && kits.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
            ) : kits.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No kits yet. Ask Sam to create one!
              </p>
            ) : (
              <div className="space-y-0.5">
                {kits.map((kit) => {
                  const isActive = selectedKitId === kit.id;
                  return (
                    <button
                      key={kit.id}
                      onClick={() => setSelectedKitId(kit.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left text-sm transition-colors",
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50"
                      )}
                    >
                      {getKitIcon(kit.icon)}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{kit.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{kit.description}</div>
                      </div>
                      {kit.enabled ? (
                        <Power className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      ) : (
                        <PowerOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right column — kit detail / webview */}
      <div className="flex-1 flex flex-col min-w-0 bg-sidebar">
        {selectedKit ? (
          <KitDetail kit={selectedKit} />
        ) : (
          <>
            <div data-tauri-drag-region className="h-12 border-b border-border shrink-0" />
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Select a kit to view</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KitDetail({ kit }: { kit: KitInfo }) {
  const { artifactsUrl } = useSettingsStore.getState();
  const baseUrl = artifactsUrl.replace(/\/__files$/, "").replace(/\/$/, "");
  const kitUrl = `${baseUrl}/kits/${kit.id}/`;

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {/* Header */}
      <div data-tauri-drag-region className="h-12 border-b border-border shrink-0 flex items-center px-4 gap-3">
        {getKitIcon(kit.icon)}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate">{kit.name}</h3>
        </div>
        <span className="text-xs text-muted-foreground">v{kit.version}</span>
        <a
          href={kitUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Open in browser"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Kit iframe */}
      {kit.enabled ? (
        <iframe
          src={kitUrl}
          className="flex-1 w-full border-0"
          title={kit.name}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <PowerOff className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">This kit is disabled</p>
          </div>
        </div>
      )}
    </div>
  );
}
