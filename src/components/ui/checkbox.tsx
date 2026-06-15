/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { wrapValueChange } from "@/lib/tracing/userTrace";

// NOTE: Unlike Button, the checkbox must NOT bridge touch via a synthetic
// `element.click()` in onPointerUp. Radix's Root toggles internally on every
// click, and the browser already emits a natural touch-click after pointerup,
// so a synthetic click double-fires the toggle (false→true) and nets to no
// visible change — making the control appear inert (BUG-031). The natural
// touch-click toggles Radix once on its own; the global pointer-up interaction
// model (buttonInteraction.ts) supplies the tap-flash for [role="checkbox"].
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, onCheckedChange, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    onCheckedChange={wrapValueChange(onCheckedChange, "toggle", "Checkbox", props, "Checkbox")}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
