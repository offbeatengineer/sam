import { PanelLeft, PanelRight } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface SidebarToggleProps {
  side: "left" | "right";
  isOpen: boolean;
  onClick: () => void;
  className?: string;
}

export function SidebarToggle({
  side,
  isOpen,
  onClick,
  className,
}: SidebarToggleProps) {
  const Icon = side === "left" ? PanelLeft : PanelRight;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", className)}
      title={`${isOpen ? "Hide" : "Show"} ${side} sidebar`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
