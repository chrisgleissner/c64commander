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
import { cn } from "@/lib/utils";
import { ModalCloseButton } from "@/components/ui/modal-close-button";

type AppSheetMode = "sheet" | "modal";

const APP_SHEET_BOTTOM_CLEARANCE = "calc(5rem + env(safe-area-inset-bottom))";

const AppSheet = DialogPrimitive.Root;
const AppDialog = DialogPrimitive.Root;

const AppSurfacePortal = DialogPrimitive.Portal;
const AppSurfaceClose = DialogPrimitive.Close;

const AppSurfaceOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 [transition-duration:var(--modal-backdrop-duration)]",
      className,
    )}
    {...props}
  />
));
AppSurfaceOverlay.displayName = "AppSurfaceOverlay";

const AppSheetModeContext = React.createContext<AppSheetMode>("sheet");

const resolveAppSheetClassName = (mode: AppSheetMode) => {
  if (mode === "modal") {
    return [
      "fixed left-1/2 top-1/2 z-50 flex w-[min(70vw,56rem)] max-w-[calc(100vw-2rem)]",
      "h-[min(80dvh,56rem)] max-h-[calc(100dvh-2rem)] min-h-[20rem] -translate-x-1/2 -translate-y-1/2",
      "flex-col overflow-hidden rounded-[28px] border bg-background p-0 shadow-2xl",
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
    ].join(" ");
  }

  return [
    "fixed inset-x-0 bottom-0 z-50 flex w-full flex-col overflow-hidden rounded-t-[28px] border border-b-0 bg-background p-0 shadow-2xl",
    "top-[max(3.25rem,calc(env(safe-area-inset-top)+2.75rem))] min-h-0",
    "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
    "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
  ].join(" ");
};

type AppSheetContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  closeTestId?: string;
};

const AppSheetContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, AppSheetContentProps>(
  ({ className, children, showClose = true, closeTestId, style, ...props }, ref) => {
    const { profile } = useDisplayProfile();
    const mode: AppSheetMode = profile === "expanded" ? "modal" : "sheet";
    const contentStyle =
      mode === "sheet"
        ? ({
            ...((style as React.CSSProperties | undefined) ?? {}),
            "--app-sheet-bottom-clearance": APP_SHEET_BOTTOM_CLEARANCE,
          } as React.CSSProperties)
        : style;

    return (
      <AppSheetModeContext.Provider value={mode}>
        <AppSurfacePortal>
          <AppSurfaceOverlay />
          <DialogPrimitive.Content
            ref={ref}
            className={cn(
              resolveAppSheetClassName(mode),
              mode === "sheet" ? "pb-[var(--app-sheet-bottom-clearance)]" : null,
              className,
            )}
            style={contentStyle}
            data-app-surface="sheet"
            data-sheet-presentation={mode}
            {...props}
          >
            {children}
            {showClose ? (
              <DialogPrimitive.Close asChild>
                <ModalCloseButton data-testid={closeTestId} />
              </DialogPrimitive.Close>
            ) : null}
          </DialogPrimitive.Content>
        </AppSurfacePortal>
      </AppSheetModeContext.Provider>
    );
  },
);
AppSheetContent.displayName = "AppSheetContent";

const AppSheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "shrink-0 border-b border-border bg-background/95 px-4 pb-3 pt-4 backdrop-blur supports-[backdrop-filter]:bg-background/85",
      className,
    )}
    {...props}
  />
);

const AppSheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex-1 min-h-0 overflow-y-auto overscroll-contain", className)} {...props} />
);

const AppSheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const mode = React.useContext(AppSheetModeContext);

  return (
    <div
      className={cn(
        "shrink-0 border-t border-border bg-background/95 px-4 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/85",
        mode === "sheet" ? "pb-[max(1rem,env(safe-area-inset-bottom))]" : "pb-[calc(1rem+env(safe-area-inset-bottom))]",
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
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
AppSheetDescription.displayName = DialogPrimitive.Description.displayName;

type AppDialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  closeTestId?: string;
};

const AppDialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, AppDialogContentProps>(
  ({ className, children, showClose = true, closeTestId, style, ...props }, ref) => (
    <AppSurfacePortal>
      <AppSurfaceOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex w-[min(90vw,32rem)] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[24px] border bg-background p-0 shadow-2xl",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        data-app-surface="dialog"
        // tailwindcss-animate's .animate-in class resets --tw-enter-translate-x/y
        // to `initial` (→ 0), which overrides the -translate-x/y-1/2 centering
        // mid-animation.  Inline style wins over class rules and restores the
        // correct starting translate so the dialog stays centred while scaling.
        style={
          {
            "--tw-enter-translate-x": "-50%",
            "--tw-enter-translate-y": "-50%",
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close asChild>
            <ModalCloseButton data-testid={closeTestId} />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </AppSurfacePortal>
  ),
);
AppDialogContent.displayName = "AppDialogContent";

const AppDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("shrink-0 border-b border-border px-4 pb-3 pt-4", className)} {...props} />
);

const AppDialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("min-h-0 px-4 py-4", className)} {...props} />
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
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
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
