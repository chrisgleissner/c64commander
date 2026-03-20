import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
    title: string;
    supportingText?: string | null;
    contributor: string;
    isCompact: boolean;
};

export function IssueCard({ title, supportingText, contributor, isCompact }: Props) {
    return (
        <section
            className={cn(
                "bg-card border rounded-xl border-amber-500/30 bg-amber-500/5",
                isCompact ? "p-3 space-y-3" : "p-4 space-y-4",
            )}
            data-testid="issue-card"
        >
            <div className="flex items-start gap-3">
                <span className="rounded-lg bg-amber-500/10 p-2 text-amber-600" aria-hidden="true">
                    <TriangleAlert className="h-4 w-4" />
                </span>
                <div className="min-w-0 space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-600">Issue</p>
                    <p className={cn("font-medium text-foreground", isCompact ? "text-sm" : "text-base")}>{title}</p>
                    <p className="text-xs text-muted-foreground">{contributor}</p>
                    {supportingText ? <p className="text-sm text-muted-foreground">{supportingText}</p> : null}
                </div>
            </div>
        </section>
    );
}
