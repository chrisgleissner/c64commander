/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import { CloseControl } from "@/components/ui/modal-close-button";
import {
  APP_INTERSTITIAL_BACKDROP_CLASSNAME,
  INTERSTITIAL_Z_INDEX,
  resolveInterstitialBackdropStyle,
} from "@/components/ui/interstitialStyles";
import { useCenteredOverlayPosition, useWorkflowSheetPosition } from "@/components/ui/useCenteredOverlayPosition";
import { useRegisterInterstitial } from "@/components/ui/interstitial-state";

const APP_SHEET_BOTTOM_CLEARANCE = "calc(5rem + env(safe-area-inset-bottom))";

const AppSheet = DialogPrimitive.Root;
const AppDialog = DialogPrimitive.Root;

const AppSurfacePortal = DialogPrimitive.Portal;
const AppSurfaceClose = DialogPrimitive.Close;

type AppSurfaceHeaderContextValue = {
  closeTestId?: string;
  showClose: boolean;
};

const AppSurfaceHeaderContext = React.createContext<AppSurfaceHeaderContextValue>({
  showClose: true,
});

function useInterstitialOpenState(nodeRef: React.RefObject<HTMLElement | null>, nodeVersion: number) {
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

const APP_INTERSTITIAL_HEADER_STYLE = {
  paddingLeft: "calc(var(--display-profile-page-padding-x) + env(safe-area-inset-left))",
  paddingRight: "calc(var(--display-profile-page-padding-x) + env(safe-area-inset-right))",
  paddingTop: "0.625rem",
  paddingBottom: "0.625rem",
} satisfies React.CSSProperties;

type HeaderSlots = {
  description: React.ReactNode | null;
  extras: React.ReactNode[];
  title: React.ReactNode | null;
};

function collectHeaderSlots(
  children: React.ReactNode,
  titleComponent: React.ElementType,
  descriptionComponent: React.ElementType,
): HeaderSlots {
  const slots: HeaderSlots = {
    description: null,
    extras: [],
    title: null,
  };

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      if (child !== null && child !== undefined && child !== false) {
        slots.extras.push(child);
      }
      return;
    }

    if (child.type === titleComponent && slots.title === null) {
      slots.title = child;
      return;
    }

    if (child.type === descriptionComponent && slots.description === null) {
      slots.description = child;
      return;
    }

    slots.extras.push(child);
  });

  return slots;
}

type AppSurfaceHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  actions?: React.ReactNode;
  closeTestId?: string;
  descriptionContent?: React.ReactNode;
  hideClose?: boolean;
  titleContent?: React.ReactNode;
};

function renderAppSurfaceHeader(
  props: AppSurfaceHeaderProps,
  context: AppSurfaceHeaderContextValue,
  titleComponent: React.ElementType,
  descriptionComponent: React.ElementType,
) {
  const {
    actions,
    children,
    className,
    closeTestId,
    descriptionContent,
    hideClose = false,
    style,
    titleContent,
    ...rest
  } = props;
  const slots = collectHeaderSlots(children, titleComponent, descriptionComponent);
  const resolvedTitle = titleContent ?? slots.title;
  const resolvedDescription = descriptionContent ?? slots.description;
  const shouldShowClose = !hideClose && context.showClose;
  const resolvedCloseTestId = closeTestId ?? context.closeTestId;

  return (
    <div
      className={cn("shrink-0 border-b border-border bg-background", className)}
      style={{
        ...APP_INTERSTITIAL_HEADER_STYLE,
        ...((style as React.CSSProperties | undefined) ?? {}),
      }}
      {...rest}
    >
      <div className="flex min-h-10 items-center gap-3">
        <div className="min-w-0 flex-1">{resolvedTitle}</div>
        {actions || shouldShowClose ? (
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {shouldShowClose ? (
              <AppSurfaceClose asChild>
                <CloseControl data-testid={resolvedCloseTestId} />
              </AppSurfaceClose>
            ) : null}
          </div>
        ) : null}
      </div>
      {resolvedDescription ? <div className="mt-0.5 min-w-0">{resolvedDescription}</div> : null}
      {slots.extras.length > 0 ? <div className="mt-2 min-w-0 space-y-2">{slots.extras}</div> : null}
    </div>
  );
}

const AppSurfaceOverlay = React.forwardRef<
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
AppSurfaceOverlay.displayName = "AppSurfaceOverlay";

type AppSheetContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  closeTestId?: string;
};

const AppSheetContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, AppSheetContentProps>(
  ({ className, children, showClose = true, closeTestId, style, ...props }, ref) => {
    const {
      composedRef,
      nodeRef,
      nodeVersion,
      style: positionedStyle,
    } = useWorkflowSheetPosition(ref, "AppSheetContent");
    const isOpen = useInterstitialOpenState(nodeRef, nodeVersion);
    const layer = useRegisterInterstitial("sheet", isOpen);
    const contentStyle = {
      ...positionedStyle,
      ...((style as React.CSSProperties | undefined) ?? {}),
      "--app-sheet-bottom-clearance": APP_SHEET_BOTTOM_CLEARANCE,
      zIndex: layer?.surfaceZIndex ?? INTERSTITIAL_Z_INDEX.surface,
    } as React.CSSProperties;

    return (
      <AppSurfacePortal>
        <AppSurfaceOverlay depth={layer?.depth ?? 1} />
        <AppSurfaceHeaderContext.Provider value={{ closeTestId, showClose }}>
          <DialogPrimitive.Content
            ref={composedRef}
            className={cn(
              "fixed inset-x-0 bottom-0 flex min-h-0 w-full flex-col overflow-hidden border border-b-0 bg-background p-0",
              "rounded-t-[var(--interstitial-radius)] shadow-[var(--interstitial-shadow)]",
              "sm:left-1/2 sm:right-auto sm:w-[min(100vw-2rem,56rem)] sm:-translate-x-1/2",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
              "pb-[var(--app-sheet-bottom-clearance)]",
              className,
            )}
            style={contentStyle}
            data-app-surface="sheet"
            data-interstitial-depth={layer?.depth ?? 1}
            data-sheet-presentation="sheet"
            {...props}
          >
            {children}
          </DialogPrimitive.Content>
        </AppSurfaceHeaderContext.Provider>
      </AppSurfacePortal>
    );
  },
);
AppSheetContent.displayName = "AppSheetContent";

const AppSheetHeader = (props: AppSurfaceHeaderProps) => {
  const context = React.useContext(AppSurfaceHeaderContext);
  return renderAppSurfaceHeader(props, context, AppSheetTitle, AppSheetDescription);
};

const AppSheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex-1 min-h-0 overflow-y-auto overscroll-contain", className)} {...props} />
);

const AppSheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        "shrink-0 border-t border-border bg-background px-4 pt-[0.5625rem]",
        "pb-[max(1rem,env(safe-area-inset-bottom))]",
        className,
      )}
      {...props}
    />
  );
};

const AppSheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
AppSheetTitle.displayName = DialogPrimitive.Title.displayName;

const AppSheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("sr-only text-sm text-muted-foreground", className)}
    {...props}
  />
));
AppSheetDescription.displayName = DialogPrimitive.Description.displayName;

type AppDialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  closeTestId?: string;
};

const AppDialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, AppDialogContentProps>(
  ({ className, children, showClose = true, closeTestId, style, ...props }, ref) => {
    const {
      composedRef,
      nodeRef,
      nodeVersion,
      style: centeredStyle,
    } = useCenteredOverlayPosition(ref, "AppDialogContent");
    const isOpen = useInterstitialOpenState(nodeRef, nodeVersion);
    const layer = useRegisterInterstitial("modal", isOpen);

    return (
      <AppSurfacePortal>
        <AppSurfaceOverlay depth={layer?.depth ?? 1} />
        <AppSurfaceHeaderContext.Provider value={{ closeTestId, showClose }}>
          <DialogPrimitive.Content
            ref={composedRef}
            className={cn(
              "fixed left-[50dvw] flex w-[min(90dvw,32rem)] max-w-[calc(100dvw-1.5rem)] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--interstitial-radius)] border bg-background p-0 shadow-[var(--interstitial-shadow)]",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              className,
            )}
            data-app-surface="dialog"
            data-interstitial-depth={layer?.depth ?? 1}
            style={{
              ...centeredStyle,
              ...style,
              zIndex: layer?.surfaceZIndex ?? INTERSTITIAL_Z_INDEX.surface,
            }}
            {...props}
          >
            {children}
          </DialogPrimitive.Content>
        </AppSurfaceHeaderContext.Provider>
      </AppSurfacePortal>
    );
  },
);
AppDialogContent.displayName = "AppDialogContent";

const AppDialogHeader = (props: AppSurfaceHeaderProps) => {
  const context = React.useContext(AppSurfaceHeaderContext);
  return renderAppSurfaceHeader(props, context, AppDialogTitle, AppDialogDescription);
};

const AppDialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4", className)} {...props} />
);

const AppDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex shrink-0 flex-col-reverse gap-2 border-t border-border px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:justify-end",
      className,
    )}
    {...props}
  />
);

const AppDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
AppDialogTitle.displayName = DialogPrimitive.Title.displayName;

const AppDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("sr-only text-sm text-muted-foreground", className)}
    {...props}
  />
));
AppDialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetFooter,
  AppSheetHeader,
  AppSheetTitle,
  AppSurfaceClose,
};
