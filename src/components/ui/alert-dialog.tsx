/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { type ModalSurface, resolveModalPresentation } from "@/lib/modalPresentation";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { composeInterstitialOpenAutoFocus } from "@/components/ui/interstitialFocus";
import { CloseControl } from "@/components/ui/modal-close-button";
import {
  APP_INTERSTITIAL_BACKDROP_CLASSNAME,
  INTERSTITIAL_Z_INDEX,
  resolveInterstitialBackdropStyle,
} from "@/components/ui/interstitialStyles";
import { useCenteredOverlayPosition } from "@/components/ui/useCenteredOverlayPosition";
import { useRegisterInterstitial } from "@/components/ui/interstitial-state";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogPresentationContext = React.createContext(resolveModalPresentation("medium", "confirmation"));
const AlertDialogHeaderContext = React.createContext({ showClose: true });

function useAlertDialogOpenState(nodeRef: React.RefObject<HTMLElement | null>, nodeVersion: number) {
  const [isOpen, setIsOpen] = React.useState(false);

  React.useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;

    const node = nodeRef.current;
    if (!node) return undefined;

    const update = () => {
      setIsOpen(node.getAttribute("data-state") === "open");
    };

    update();

    const observer = new MutationObserver(update);
    observer.observe(node, { attributes: true, attributeFilter: ["data-state"] });

    return () => {
      observer.disconnect();
    };
  }, [nodeRef, nodeVersion]);

  return isOpen;
}

const resolveAlertDialogFooterClassName = () => "flex-row flex-wrap justify-end gap-2";

const ALERT_DIALOG_HEADER_STYLE = {
  paddingLeft: "calc(var(--display-profile-page-padding-x) + env(safe-area-inset-left))",
  paddingRight: "calc(var(--display-profile-page-padding-x) + env(safe-area-inset-right))",
  paddingTop: "0.625rem",
  paddingBottom: "0.625rem",
} satisfies React.CSSProperties;

function collectAlertDialogHeaderSlots(children: React.ReactNode) {
  let title: React.ReactNode | null = null;
  let description: React.ReactNode | null = null;
  const extras: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      if (child !== null && child !== undefined && child !== false) {
        extras.push(child);
      }
      return;
    }

    if (child.type === AlertDialogTitle && title === null) {
      title = child;
      return;
    }

    if (child.type === AlertDialogDescription && description === null) {
      description = child;
      return;
    }

    extras.push(child);
  });

  return { description, extras, title };
}

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay> & { depth?: number }
>(({ className, depth = 1, style, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      APP_INTERSTITIAL_BACKDROP_CLASSNAME,
      className,
    )}
    data-interstitial-depth={depth}
    style={{ ...resolveInterstitialBackdropStyle(depth), ...style }}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & { surface?: ModalSurface }
>(({ className, onOpenAutoFocus, surface = "confirmation", ...props }, ref) => {
  const { profile } = useDisplayProfile();
  const presentation = React.useMemo(() => resolveModalPresentation(profile, surface), [profile, surface]);
  const { composedRef, nodeRef, nodeVersion, style } = useCenteredOverlayPosition(
    ref,
    `AlertDialogContent[${surface}]`,
  );
  const isOpen = useAlertDialogOpenState(nodeRef, nodeVersion);
  const layer = useRegisterInterstitial("modal", isOpen);

  return (
    <AlertDialogPresentationContext.Provider value={presentation}>
      <AlertDialogHeaderContext.Provider value={{ showClose: true }}>
        <AlertDialogPortal>
          <AlertDialogOverlay depth={layer?.depth ?? 1} />
          <AlertDialogPrimitive.Content
            ref={composedRef}
            className={cn(presentation.contentClassName, className)}
            data-interstitial-depth={layer?.depth ?? 1}
            data-modal-surface={surface}
            data-modal-presentation={presentation.mode}
            onOpenAutoFocus={composeInterstitialOpenAutoFocus(onOpenAutoFocus)}
            style={{ ...style, zIndex: layer?.surfaceZIndex ?? INTERSTITIAL_Z_INDEX.surface }}
            {...props}
          />
        </AlertDialogPortal>
      </AlertDialogHeaderContext.Provider>
    </AlertDialogPresentationContext.Provider>
  );
});
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

type AlertDialogHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  actions?: React.ReactNode;
  descriptionContent?: React.ReactNode;
  hideClose?: boolean;
  titleContent?: React.ReactNode;
};

const AlertDialogHeader = ({
  actions,
  children,
  className,
  descriptionContent,
  hideClose = false,
  style,
  titleContent,
  ...props
}: AlertDialogHeaderProps) => {
  const { showClose } = React.useContext(AlertDialogHeaderContext);
  const slots = collectAlertDialogHeaderSlots(children);
  const resolvedTitle = titleContent ?? slots.title;
  const resolvedDescription = descriptionContent ?? slots.description;
  const shouldShowClose = !hideClose && showClose;

  return (
    <div
      className={cn("shrink-0 border-b border-border bg-background text-left", className)}
      style={{ ...ALERT_DIALOG_HEADER_STYLE, ...((style as React.CSSProperties | undefined) ?? {}) }}
      {...props}
    >
      <div className="flex min-h-10 items-center gap-3" data-interstitial-header-row="true">
        <div className="min-w-0 flex-1">{resolvedTitle}</div>
        {actions || shouldShowClose ? (
          <div className="flex shrink-0 items-center gap-2" data-interstitial-header-actions="true">
            {actions}
            {shouldShowClose ? (
              <AlertDialogPrimitive.Cancel asChild>
                <CloseControl />
              </AlertDialogPrimitive.Cancel>
            ) : null}
          </div>
        ) : null}
      </div>
      {resolvedDescription ? <div className="mt-0.5 min-w-0">{resolvedDescription}</div> : null}
      {slots.extras.length > 0 ? <div className="mt-2 min-w-0 space-y-2">{slots.extras}</div> : null}
    </div>
  );
};
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const presentation = React.useContext(AlertDialogPresentationContext);
  return (
    <div
      className={cn("flex", resolveAlertDialogFooterClassName(), presentation.footerClassName, className)}
      {...props}
    />
  );
};
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("sr-only text-sm text-muted-foreground", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel ref={ref} className={cn(buttonVariants({ variant: "outline" }), className)} {...props} />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
