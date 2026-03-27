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
import { ModalCloseButton } from "@/components/ui/modal-close-button";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
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
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  closeTestId?: string;
  surface?: ModalSurface;
};

const DialogPresentationContext = React.createContext(resolveModalPresentation("medium", "default"));

const resolveDialogFooterClassName = () => "flex-row flex-wrap justify-end gap-2";

const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({ className, children, showClose = true, closeTestId, surface = "default", ...props }, ref) => {
    const { profile } = useDisplayProfile();
    const presentation = React.useMemo(() => resolveModalPresentation(profile, surface), [profile, surface]);

    return (
      <DialogPresentationContext.Provider value={presentation}>
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content
            ref={ref}
            className={cn(presentation.contentClassName, className)}
            data-modal-surface={surface}
            data-modal-presentation={presentation.mode}
            {...props}
          >
            {children}
            {showClose ? (
              <DialogPrimitive.Close asChild>
                <ModalCloseButton data-testid={closeTestId} />
              </DialogPrimitive.Close>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPortal>
      </DialogPresentationContext.Provider>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const presentation = React.useContext(DialogPresentationContext);
  return (
    <div
      className={cn("flex", resolveDialogFooterClassName(), presentation.footerClassName, className)}
      {...props}
    />
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
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
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
