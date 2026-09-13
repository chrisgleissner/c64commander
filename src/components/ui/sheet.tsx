/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useRegisterInterstitial } from "@/components/ui/interstitial-state";
import {
  APP_INTERSTITIAL_BACKDROP_CLASSNAME,
  INTERSTITIAL_Z_INDEX,
  resolveInterstitialBackdropStyle,
} from "@/components/ui/interstitialStyles";

const assignRef = <T,>(ref: React.ForwardedRef<T>, value: T | null) => {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
};

/**
 * Tracks whether the sheet's own Radix content node is open, so its backdrop can dim by depth
 * (see `useRegisterInterstitial`) the same way `Dialog` and `AppSurface` already do. Sheet used a
 * flat opaque `bg-scrim` with no opacity instead, which is correct for nothing it is layered over:
 * a sheet that stops short of the top of the screen (every one at other than compact density, see
 * `sheetVariants`) showed solid black above it rather than the app page dimmed behind it.
 */
function useSheetOpenState(forwardedRef: React.ForwardedRef<HTMLDivElement>) {
  const localRef = React.useRef<HTMLDivElement | null>(null);
  const [nodeVersion, setNodeVersion] = React.useState(0);
  const [isOpen, setIsOpen] = React.useState(false);

  const composedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      assignRef(forwardedRef, node);
      if (node !== localRef.current) {
        localRef.current = node;
        setNodeVersion((current) => current + 1);
      }
    },
    [forwardedRef],
  );

  React.useLayoutEffect(() => {
    const node = localRef.current;
    if (!node) return undefined;

    const update = () => setIsOpen(node.getAttribute("data-state") === "open");
    update();

    const observer = new MutationObserver(update);
    observer.observe(node, { attributes: true, attributeFilter: ["data-state"] });
    return () => observer.disconnect();
  }, [nodeVersion]);

  return { composedRef, isOpen };
}

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay> & { depth?: number }
>(({ className, depth = 1, style, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      APP_INTERSTITIAL_BACKDROP_CLASSNAME,
      className,
    )}
    data-interstitial-depth={depth}
    {...props}
    style={{ ...resolveInterstitialBackdropStyle(depth), ...style }}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background shadow-elev-2 transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-[var(--safe-area-inset-top)] border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-[var(--safe-area-inset-bottom)] border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "top-[var(--safe-area-inset-top)] bottom-[var(--safe-area-inset-bottom)] left-0 w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "top-[var(--safe-area-inset-top)] bottom-[var(--safe-area-inset-bottom)] right-0 w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
      /*
       * Compact takes the whole panel and trims the padding. On a 320x427 screen a bottom sheet
       * capped at 85% of the height gives up 64px to a backdrop nobody interacts with, and 24px of
       * side padding takes another 15% of the width. Both matter more here than the visual cue
       * that something is layered over the page, which the animation already provides.
       */
      density: {
        compact:
          "max-h-[100dvh] px-3 pt-[calc(0.75rem+var(--safe-area-inset-top))] pb-[calc(0.75rem+var(--safe-area-inset-bottom))]",
        // No inset in the padding: every side already offsets the sheet by the status and navigation
        // bars, and adding them again cost a bottom sheet 78px of list on a Pixel 4 (30 top, 48 bottom).
        standard: "max-h-[85dvh] px-6 pt-6 pb-6",
      },
    },
    defaultVariants: {
      side: "right",
      density: "standard",
    },
  },
);

interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    Omit<VariantProps<typeof sheetVariants>, "density"> {}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, style, ...props }, ref) => {
    const { profile } = useDisplayProfile();
    const density = profile === "compact" ? "compact" : "standard";
    const { composedRef, isOpen } = useSheetOpenState(ref);
    const layer = useRegisterInterstitial("sheet", isOpen);

    return (
      <SheetPortal>
        <SheetOverlay depth={layer?.depth ?? 1} />
        <SheetPrimitive.Content
          ref={composedRef}
          className={cn(sheetVariants({ side, density }), className)}
          data-interstitial-depth={layer?.depth ?? 1}
          {...props}
          style={{ ...style, zIndex: layer?.surfaceZIndex ?? INTERSTITIAL_Z_INDEX.surface }}
        >
          {children}
          <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-secondary hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        </SheetPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
