/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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

export type ModalPresentationMode = "centered" | "large";

export type ModalPresentation = {
  surface: ModalSurface;
  mode: ModalPresentationMode;
  contentClassName: string;
  footerClassName: string;
};

const centeredBaseClass =
  "fixed left-[50%] top-[50%] z-50 grid w-[min(calc(100vw-1.5rem),var(--display-profile-modal-max-width))] max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overflow-x-hidden rounded-[var(--interstitial-radius)] border bg-background p-6 shadow-[var(--interstitial-shadow)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]";

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
        mode: "large",
        contentClassName: largeDialogClass,
        footerClassName: stickyFooterClass,
      };
    case "list-browser":
      return {
        surface,
        mode: "large",
        contentClassName: listDialogClass,
        footerClassName: stickyFooterClass,
      };
    case "secondary-editor":
      return {
        surface,
        mode: "centered",
        contentClassName: `${defaultDialogClass} overflow-hidden`,
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
        mode: "centered",
        contentClassName: commandPaletteClass,
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
