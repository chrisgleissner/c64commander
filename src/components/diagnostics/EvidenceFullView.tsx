import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
    totalCount: number;
    visibleCount: number;
    newestEntryLabel: string;
    activeFilterPills: string[];
    isFiltersModified: boolean;
    onResetFilters: () => void;
    isCompact: boolean;
    children: ReactNode;
};

export function EvidenceFullView({
    totalCount,
    visibleCount,
    newestEntryLabel,
    activeFilterPills,
    isFiltersModified,
    onResetFilters,
    isCompact,
    children,
}: Props) {
    return (
        <section className="space-y-3" data-testid="evidence-full-view">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 pb-2">
                <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Activity</p>
                        <Badge variant="outline" className="border-border bg-background/80 text-muted-foreground">
                            Showing {visibleCount} of {totalCount}
                        </Badge>
                        <Badge variant="outline" className="border-border bg-background/80 text-muted-foreground">
                            Latest {newestEntryLabel}
                        </Badge>
                    </div>
                    {activeFilterPills.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                            {activeFilterPills.map((pill) => (
                                <Badge key={pill} variant="outline" className="border-border bg-background/80 text-muted-foreground">
                                    {pill}
                                </Badge>
                            ))}
                        </div>
                    ) : null}
                </div>

                {isFiltersModified ? (
                    <Button variant="ghost" size="sm" onClick={onResetFilters} data-testid="reset-filters-button">
                        Reset filters
                    </Button>
                ) : null}
            </div>

            <div className={cn("min-h-0", isCompact ? "space-y-1.5" : "space-y-2")}>{children}</div>
        </section>
    );
}
