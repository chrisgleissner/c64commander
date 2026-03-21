import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

type PreviewItem = {
  id: string;
  title: string;
  supportingText: string;
};

type Props = {
  expanded: boolean;
  onToggle: () => void;
  onViewAll: () => void;
  items: PreviewItem[];
  isCompact: boolean;
};

export function EvidencePreviewCard({ expanded, onToggle, onViewAll, items, isCompact }: Props) {
  return (
    <section
      className={cn("bg-card border border-border rounded-xl", isCompact ? "p-3 space-y-3" : "p-4 space-y-4")}
      data-testid="evidence-preview-card"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid="evidence-preview-toggle"
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recent activity</p>
          <p className="text-sm text-muted-foreground">A short preview of the latest activity in this session.</p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {expanded ? (
        <div className="space-y-3">
          {items.length > 0 ? (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-border/70 bg-background/60 p-3"
                  data-testid={`preview-item-${item.id}`}
                >
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.supportingText}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No recent activity yet.</p>
          )}

          <button
            type="button"
            onClick={onViewAll}
            data-testid="view-all-activity"
            className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
          >
            View all activity
          </button>
        </div>
      ) : null}
    </section>
  );
}
