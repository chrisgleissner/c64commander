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

export function TechnicalDetailsCard({ expanded, onToggle, summary, isCompact, children }: Props) {
    return (
        <section
            className={cn("bg-card border border-border rounded-xl", isCompact ? "p-3 space-y-3" : "p-4 space-y-4")}
            data-testid="technical-details-card"
        >
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                data-testid="technical-details-toggle"
                className="flex w-full items-center justify-between gap-3 text-left"
            >
                <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Technical details
                    </p>
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
