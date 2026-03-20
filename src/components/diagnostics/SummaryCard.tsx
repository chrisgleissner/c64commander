import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ActionConfig = {
  label: string;
  onClick: () => void;
  testId?: string;
  variant?: "default" | "outline" | "ghost" | "link";
};

type Props = {
  badgeLabel: string;
  title: string;
  titleToneClassName: string;
  statusGlyph: string;
  statusGlyphClassName: string;
  headline: string;
  supportingText?: string | null;
  isCompact: boolean;
  primaryAction?: ActionConfig;
  secondaryAction?: ActionConfig;
  footerAction?: ActionConfig;
  children?: ReactNode;
};

export function SummaryCard({
  badgeLabel,
  title,
  titleToneClassName,
  statusGlyph,
  statusGlyphClassName,
  headline,
  supportingText,
  isCompact,
  primaryAction,
  secondaryAction,
  footerAction,
  children,
}: Props) {
  return (
    <section
      className={cn("bg-card border border-border rounded-xl", isCompact ? "p-3 space-y-3" : "p-4 space-y-4")}
      data-testid="status-summary-card"
    >
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn("font-mono leading-none shrink-0", isCompact ? "text-xl" : "text-2xl", statusGlyphClassName)}
          >
            {statusGlyph}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{badgeLabel}</p>
            <h2 className={cn("font-semibold", isCompact ? "text-base" : "text-lg", titleToneClassName)}>{title}</h2>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className={cn("font-medium text-foreground", isCompact ? "text-sm" : "text-base")}>{headline}</p>
          {supportingText ? <p className="text-sm text-muted-foreground">{supportingText}</p> : null}
        </div>
      </div>

      {children}

      {(primaryAction || secondaryAction || footerAction) && (
        <div className="space-y-2">
          {(primaryAction || secondaryAction) && (
            <div className={cn("gap-2", secondaryAction ? "grid grid-cols-1 sm:grid-cols-2" : "grid grid-cols-1")}>
              {primaryAction ? (
                <Button
                  size="sm"
                  onClick={primaryAction.onClick}
                  data-testid={primaryAction.testId}
                  variant={primaryAction.variant ?? "default"}
                  className="w-full"
                >
                  {primaryAction.label}
                </Button>
              ) : null}
              {secondaryAction ? (
                <Button
                  size="sm"
                  onClick={secondaryAction.onClick}
                  data-testid={secondaryAction.testId}
                  variant={secondaryAction.variant ?? "ghost"}
                  className="w-full"
                >
                  {secondaryAction.label}
                </Button>
              ) : null}
            </div>
          )}

          {footerAction ? (
            <button
              type="button"
              onClick={footerAction.onClick}
              data-testid={footerAction.testId}
              className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
            >
              {footerAction.label}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
