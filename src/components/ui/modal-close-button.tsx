/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared visual close button for all modal surfaces (Dialog, Popover-as-Dialog, etc.).
 * Defaults to `position: absolute; right: 1rem; top: 1rem` — pass `className` to override.
 * Pair with the relevant Radix `*.Close asChild` wrapper to wire up dismiss behavior.
 */
export const ModalCloseButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/80 text-foreground/80 shadow-sm ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none",
        className,
      )}
      {...props}
    >
      <X className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </button>
  ),
);
ModalCloseButton.displayName = "ModalCloseButton";
