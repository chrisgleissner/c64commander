/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export const CloseControl = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center self-center border-0 bg-transparent p-0 text-[1.75rem] font-normal leading-none text-foreground/80 shadow-none transition-colors hover:bg-transparent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="pointer-events-none inline-block leading-none">
        {children ?? "×"}
      </span>
      <span className="sr-only">Close</span>
    </button>
  ),
);
CloseControl.displayName = "CloseControl";

export const ModalCloseButton = CloseControl;
