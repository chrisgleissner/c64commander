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

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: React.ReactNode;
  "data-testid"?: string;
};

/**
 * §5.3 — Nested analytic popup. Opens above the diagnostics overlay (z-[60]).
 * Dims the overlay further but keeps it visually recognizable underneath.
 * §5.4 — Close order: this popup closes before the overlay.
 * §5.7 — Back/Escape: closes this popup, not the overlay.
 */
export function AnalyticPopup({ open, onClose, title, description, children, "data-testid": testId }: Props) {
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
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        {/* §5.6 — Additional dim over diagnostics overlay */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {/* §5.5 — Popup content with own scroll, title, close affordance */}
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61]",
            "w-[min(90vw,52rem)] h-[min(80dvh,48rem)]",
            "flex flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
          data-testid={testId ?? "analytic-popup"}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onClose();
          }}
          onInteractOutside={(e) => {
            e.preventDefault();
          }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-sm font-semibold truncate">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs text-muted-foreground truncate mt-0.5">
                {description}
              </DialogPrimitive.Description>
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

          {/* Scrollable body */}
          <div className="flex flex-1 min-h-0 overflow-auto flex-col">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
