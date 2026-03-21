/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from "react";

import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  expanded: boolean;
  onToggle: () => void;
  summary: string;
  isCompact: boolean;
  children?: ReactNode;
};

export function ToolsCard({ expanded, onToggle, summary, isCompact, children }: Props) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border/80 bg-background/60",
        isCompact ? "p-3 space-y-3" : "p-4 space-y-4",
      )}
      data-testid="tools-card"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid="tools-card-toggle"
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Tools</p>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {expanded ? <div className="space-y-4">{children}</div> : null}
    </section>
  );
}
