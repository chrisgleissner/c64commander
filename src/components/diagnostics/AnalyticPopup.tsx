/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §5.1 / §5.5 — Nested analytic popup layer.
// Renders above the diagnostics overlay. Only one may be open at a time.
// The diagnostics overlay stays mounted underneath, rendered inert.

import { useEffect } from "react";
import { X } from "lucide-react";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  contentClassName?: string;
  "data-testid"?: string;
};

/**
 * §5.3 — Nested analytic popup. Opens above the diagnostics overlay (z-[60]).
 * Dims the overlay further but keeps it visually recognizable underneath.
 * §5.4 — Close order: this popup closes before the overlay.
 * §5.7 — Back/Escape: closes this popup, not the overlay.
 */
export function AnalyticPopup({
  open,
  onClose,
  title,
  description,
  children,
  contentClassName,
  "data-testid": testId,
}: Props) {
  // §5.7 — Escape key closes only this popup, not the parent overlay
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <AppSheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <AppSheetContent
        showClose={false}
        className={cn("z-[61] overflow-hidden p-0 sm:w-[min(100vw-2rem,52rem)]", contentClassName)}
        data-testid={testId ?? "analytic-popup"}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onClose();
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <AppSheetDescription className="sr-only">{description ?? `${title} details.`}</AppSheetDescription>
        <AppSheetHeader className="border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Return to Diagnostics"
                  data-testid="analytic-popup-return"
                >
                  ← Diagnostics
                </button>
                <AppSheetTitle className="min-w-0 truncate text-sm font-semibold">{title}</AppSheetTitle>
              </div>
              {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded p-1 hover:bg-muted transition-colors"
              aria-label="Close"
              data-testid="analytic-popup-close"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </AppSheetHeader>
        <AppSheetBody className="flex min-h-0 flex-col overflow-auto">{children}</AppSheetBody>
      </AppSheetContent>
    </AppSheet>
  );
}
