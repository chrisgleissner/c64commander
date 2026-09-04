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

// The `enter` and `exit` keyframes of tailwindcss-animate assign the whole
// `transform` property, so they discard the `translateX(-50%)` that centres the
// overlay unless the class list also names an enter and exit translate. Without
// the two `left-1/2` classes below, a modal animates in from `translateX(0)` and
// is off centre — and past the right edge on a narrow viewport — for the whole
// animation. Keep them next to any horizontal centering transform.
const centeredAnimationClass =
  "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=closed]:slide-out-to-left-1/2";

const centeredBaseClass = `fixed left-[50dvw] grid w-[min(calc(100dvw-1.5rem),var(--display-profile-modal-max-width))] translate-x-[-50%] gap-4 overflow-hidden rounded-[var(--interstitial-radius)] border bg-background p-6 shadow-[var(--interstitial-shadow)] outline-none ${centeredAnimationClass}`;

/** Class list of `AppDialogContent`; kept here so every centered overlay shares one definition. */
export const APP_DIALOG_CONTENT_CLASS = `fixed left-[50dvw] flex w-[min(90dvw,32rem)] max-w-[calc(100dvw-1.5rem)] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--interstitial-radius)] border bg-background p-0 shadow-[var(--interstitial-shadow)] ${centeredAnimationClass}`;

/**
 * Class list of `AppSheetContent`. The sheet is full width and not transform-centred below the `sm`
 * breakpoint, so its enter and exit translate only needs the `sm:` variant.
 */
export const APP_SHEET_CONTENT_CLASS = [
  "fixed inset-x-0 bottom-0 flex min-h-0 w-full flex-col overflow-hidden border border-b-0 bg-background p-0",
  "rounded-t-[var(--interstitial-radius)] shadow-[var(--interstitial-shadow)]",
  "sm:left-1/2 sm:right-auto sm:w-[min(100vw-2rem,56rem)] sm:-translate-x-1/2",
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
  "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
  "sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=closed]:slide-out-to-left-1/2",
  "pb-[var(--app-sheet-bottom-clearance)]",
].join(" ");

const stickyFooterClass =
  "sticky bottom-0 z-10 mt-auto border-t border-border bg-background pb-[calc(1rem+var(--safe-area-inset-bottom))]";

const largeDialogClass = `${centeredBaseClass} max-w-4xl overflow-hidden p-0`;
const listDialogClass = `${centeredBaseClass} max-w-[42rem] overflow-hidden p-0`;
const popoverDialogClass = `${centeredBaseClass} w-80 max-w-[calc(100dvw-2rem)] p-0`;
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
