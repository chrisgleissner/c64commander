import type { DisplayProfile } from "@/lib/displayProfiles";

export const MODAL_SURFACES = [
  "default",
  "confirmation",
  "selection-browser",
  "list-browser",
  "secondary-editor",
  "popover",
  "command-palette",
] as const;

export type ModalSurface = (typeof MODAL_SURFACES)[number];

export type ModalPresentationMode = "centered" | "fullscreen" | "large";

export type ModalPresentation = {
  surface: ModalSurface;
  mode: ModalPresentationMode;
  contentClassName: string;
  footerClassName: string;
};

const centeredBaseClass =
  "fixed left-[50%] top-[50%] z-50 grid w-[calc(var(--display-profile-viewport-width)-2*var(--display-profile-modal-inset)-env(safe-area-inset-left)-env(safe-area-inset-right))] max-h-[calc(var(--display-profile-viewport-height)-2*var(--display-profile-modal-inset)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overflow-x-hidden border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg";

const fullscreenBaseClass =
  "fixed inset-[var(--display-profile-modal-inset)] z-50 grid h-[calc(var(--display-profile-viewport-height)-2*var(--display-profile-modal-inset)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-[calc(var(--display-profile-viewport-width)-2*var(--display-profile-modal-inset)-env(safe-area-inset-left)-env(safe-area-inset-right))] max-h-[calc(var(--display-profile-viewport-height)-2*var(--display-profile-modal-inset)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-w-[calc(var(--display-profile-viewport-width)-2*var(--display-profile-modal-inset)-env(safe-area-inset-left)-env(safe-area-inset-right))] gap-0 overflow-hidden rounded-lg border bg-background p-0 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";

const selectionBrowserFullscreenClass =
  "fixed inset-2 z-50 grid h-[calc(var(--display-profile-viewport-height)-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-[calc(var(--display-profile-viewport-width)-1rem-env(safe-area-inset-left)-env(safe-area-inset-right))] max-h-[calc(var(--display-profile-viewport-height)-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-w-[calc(var(--display-profile-viewport-width)-1rem-env(safe-area-inset-left)-env(safe-area-inset-right))] gap-0 overflow-hidden rounded-lg border bg-background p-0 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";

const stickyFooterClass =
  "sticky bottom-0 z-10 mt-auto border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[calc(1rem+env(safe-area-inset-bottom))]";

const largeDialogClass = `${centeredBaseClass} max-w-4xl overflow-hidden p-0`;
const listDialogClass = `${centeredBaseClass} max-w-[42rem] overflow-hidden p-0`;
const popoverDialogClass = `${centeredBaseClass} w-80 max-w-[calc(100vw-2rem)] p-0`;
const commandPaletteClass = `${centeredBaseClass} max-w-xl overflow-hidden p-0`;
const defaultDialogClass = `${centeredBaseClass} max-w-[var(--display-profile-modal-max-width)]`;

export const resolveModalPresentation = (profile: DisplayProfile, surface: ModalSurface): ModalPresentation => {
  switch (surface) {
    case "selection-browser":
      return {
        surface,
        mode: profile === "compact" ? "fullscreen" : "large",
        contentClassName: profile === "compact" ? selectionBrowserFullscreenClass : largeDialogClass,
        footerClassName: stickyFooterClass,
      };
    case "list-browser":
      return {
        surface,
        mode: profile === "compact" ? "fullscreen" : "large",
        contentClassName: profile === "compact" ? fullscreenBaseClass : listDialogClass,
        footerClassName: stickyFooterClass,
      };
    case "secondary-editor":
      return {
        surface,
        mode: profile === "compact" ? "fullscreen" : "centered",
        contentClassName: profile === "compact" ? fullscreenBaseClass : `${defaultDialogClass} overflow-hidden`,
        footerClassName: stickyFooterClass,
      };
    case "popover":
      return {
        surface,
        mode: "centered",
        contentClassName: popoverDialogClass,
        footerClassName: "",
      };
    case "command-palette":
      return {
        surface,
        mode: profile === "compact" ? "fullscreen" : "centered",
        contentClassName: profile === "compact" ? fullscreenBaseClass : commandPaletteClass,
        footerClassName: stickyFooterClass,
      };
    case "confirmation":
    case "default":
    default:
      return {
        surface,
        mode: "centered",
        contentClassName: defaultDialogClass,
        footerClassName: "",
      };
  }
};
