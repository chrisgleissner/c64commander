/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { type ModalSurface, resolveModalPresentation } from "@/lib/modalPresentation";
import { cn } from "@/lib/utils";
import { CloseControl } from "@/components/ui/modal-close-button";
import { composeInterstitialOpenAutoFocus } from "@/components/ui/interstitialFocus";
import {
  APP_INTERSTITIAL_BACKDROP_CLASSNAME,
  INTERSTITIAL_Z_INDEX,
  resolveInterstitialBackdropStyle,
} from "@/components/ui/interstitialStyles";
import { useCenteredOverlayPosition } from "@/components/ui/useCenteredOverlayPosition";
import { useRegisterInterstitial } from "@/components/ui/interstitial-state";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & { depth?: number }
>(({ className, depth = 1, style, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 [transition-duration:var(--modal-backdrop-duration)]",
      APP_INTERSTITIAL_BACKDROP_CLASSNAME,
      className,
    )}
    data-interstitial-depth={depth}
    style={{ ...resolveInterstitialBackdropStyle(depth), ...style }}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  closeTestId?: string;
  surface?: ModalSurface;
};

const DialogPresentationContext = React.createContext(resolveModalPresentation("medium", "default"));
const DialogHeaderContext = React.createContext<{ closeTestId?: string; showClose: boolean }>({ showClose: true });

function useDialogOpenState(nodeRef: React.RefObject<HTMLElement | null>, nodeVersion: number) {
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

const resolveDialogFooterClassName = () => "flex-row flex-wrap justify-end gap-2";

const DIALOG_HEADER_STYLE = {
  paddingLeft: "calc(var(--display-profile-page-padding-x) + env(safe-area-inset-left))",
  paddingRight: "calc(var(--display-profile-page-padding-x) + env(safe-area-inset-right))",
  paddingTop: "0.625rem",
  paddingBottom: "0.625rem",
} satisfies React.CSSProperties;

function collectDialogHeaderSlots(children: React.ReactNode) {
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

    if (child.type === DialogTitle && title === null) {
      title = child;
      return;
    }

    if (child.type === DialogDescription && description === null) {
      description = child;
      return;
    }

    extras.push(child);
  });

  return { description, extras, title };
}

const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({ className, children, onOpenAutoFocus, showClose = true, closeTestId, surface = "default", ...props }, ref) => {
    const { profile } = useDisplayProfile();
    const presentation = React.useMemo(() => resolveModalPresentation(profile, surface), [profile, surface]);
    const { composedRef, nodeRef, nodeVersion, style } = useCenteredOverlayPosition(ref, `DialogContent[${surface}]`);
    const isOpen = useDialogOpenState(nodeRef, nodeVersion);
    const layer = useRegisterInterstitial("modal", isOpen);

    return (
      <DialogPresentationContext.Provider value={presentation}>
        <DialogHeaderContext.Provider value={{ closeTestId, showClose }}>
          <DialogPortal>
            <DialogOverlay depth={layer?.depth ?? 1} />
            <DialogPrimitive.Content
              ref={composedRef}
              className={cn(presentation.contentClassName, className)}
              data-interstitial-depth={layer?.depth ?? 1}
              data-modal-surface={surface}
              data-modal-presentation={presentation.mode}
              onOpenAutoFocus={composeInterstitialOpenAutoFocus(onOpenAutoFocus)}
              style={{ ...style, zIndex: layer?.surfaceZIndex ?? INTERSTITIAL_Z_INDEX.surface }}
              {...props}
            >
              {children}
            </DialogPrimitive.Content>
          </DialogPortal>
        </DialogHeaderContext.Provider>
      </DialogPresentationContext.Provider>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

type DialogHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  actions?: React.ReactNode;
  closeTestId?: string;
  descriptionContent?: React.ReactNode;
  hideClose?: boolean;
  titleContent?: React.ReactNode;
};

const DialogHeader = ({
  actions,
  children,
  className,
  closeTestId,
  descriptionContent,
  hideClose = false,
  style,
  titleContent,
  ...props
}: DialogHeaderProps) => {
  const { closeTestId: contextCloseTestId, showClose } = React.useContext(DialogHeaderContext);
  const slots = collectDialogHeaderSlots(children);
  const resolvedTitle = titleContent ?? slots.title;
  const resolvedDescription = descriptionContent ?? slots.description;
  const shouldShowClose = !hideClose && showClose;

  return (
    <div
      className={cn("shrink-0 border-b border-border bg-background text-left", className)}
      style={{ ...DIALOG_HEADER_STYLE, ...((style as React.CSSProperties | undefined) ?? {}) }}
      {...props}
    >
      <div className="flex min-h-10 items-center gap-3" data-interstitial-header-row="true">
        <div className="min-w-0 flex-1">{resolvedTitle}</div>
        {actions || shouldShowClose ? (
          <div className="flex shrink-0 items-center gap-2" data-interstitial-header-actions="true">
            {actions}
            {shouldShowClose ? (
              <DialogClose asChild>
                <CloseControl data-testid={closeTestId ?? contextCloseTestId} />
              </DialogClose>
            ) : null}
          </div>
        ) : null}
      </div>
      {resolvedDescription ? <div className="mt-0.5 min-w-0">{resolvedDescription}</div> : null}
      {slots.extras.length > 0 ? <div className="mt-2 min-w-0 space-y-2">{slots.extras}</div> : null}
    </div>
  );
};
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const presentation = React.useContext(DialogPresentationContext);
  return (
    <div className={cn("flex", resolveDialogFooterClassName(), presentation.footerClassName, className)} {...props} />
  );
};
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("sr-only text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
