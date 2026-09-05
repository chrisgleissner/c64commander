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

export type ModalPresentationMode = "centered" | "large" | "full-screen";

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
/*
 * Bounded by the viewport for the same reason as `defaultDialogClass` below: without a maximum
 * height a tall dialog runs past the screen and takes its footer with it. The body inside is
 * already `flex-1 min-h-0 overflow-y-auto` (app-surface.tsx), so bounding the container makes the
 * body shrink and scroll rather than the dialog overflow.
 */
export const APP_DIALOG_CONTENT_CLASS = `fixed left-[50dvw] flex max-h-[calc(100dvh-2rem)] w-[min(90dvw,32rem)] max-w-[calc(100dvw-1.5rem)] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--interstitial-radius)] border bg-background p-0 shadow-[var(--interstitial-shadow)] ${centeredAnimationClass}`;

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
/*
 * A centred dialog is bounded by the viewport and scrolls when its content does not fit.
 *
 * `centeredBaseClass` sets `overflow-hidden` and no maximum height, so a dialog taller than the
 * screen was simply cut off with no way to reach the rest of it. On the 480x640 panel C64U Remote
 * targets that made the Demo Mode offer unusable: the message filled the screen and the
 * "Continue in Demo Mode" button sat below the fold, unreachable by touch and absent from the
 * accessibility tree — an offer a user could read and not accept.
 *
 * `overflow-y-auto` comes after the base class so tailwind-merge keeps it over `overflow-hidden`.
 */
const defaultDialogClass = `${centeredBaseClass} max-w-[var(--display-profile-modal-max-width)] max-h-[calc(100dvh-2rem)] overflow-y-auto`;

/*
 * `overflow-hidden` after the base class, not before: tailwind-merge keeps the last class in a
 * group, and `defaultDialogClass` ends with `overflow-y-auto`. Writing them the other way round
 * silently produced a container that could neither grow nor scroll.
 */
const secondaryEditorClass = `${centeredBaseClass} max-w-[var(--display-profile-modal-max-width)] max-h-[calc(100dvh-2rem)] overflow-hidden`;

/*
 * Compact promotion, as required by docs/internals/display-profiles.md §7 ("Wide dialogs or
 * panels -> Full-screen presentation").
 *
 * A browser, list or editor centred on a 320x427 panel spends its margins, its rounded border and
 * its backdrop gap on nothing, and what is left is mostly the surface's own header and footer. The
 * target hardware also leads with a keypad rather than touch, so every band of chrome is another
 * stop the focus ring has to pass before it reaches the rows. Full screen removes the margins and
 * gives the body the panel. Confirmations and popovers are deliberately excluded: they are short
 * by nature, and a two-line question that takes over the screen reads as a failure, not a dialog.
 */
const fullScreenClass = [
  "fixed inset-0 flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-none flex-col overflow-hidden",
  "rounded-none border-0 bg-background p-0 shadow-none outline-none",
  "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
  "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
].join(" ");

const promoteToFullScreen = (surface: ModalSurface): ModalPresentation => ({
  surface,
  mode: "full-screen",
  contentClassName: fullScreenClass,
  footerClassName: stickyFooterClass,
});

/** Surfaces that hold a list, a browser or an editor, and so earn the whole panel at compact. */
const FULL_SCREEN_AT_COMPACT: ReadonlySet<ModalSurface> = new Set([
  "selection-browser",
  "list-browser",
  "secondary-editor",
  "command-palette",
]);

export const resolveModalPresentation = (profile: DisplayProfile, surface: ModalSurface): ModalPresentation => {
  if (profile === "compact" && FULL_SCREEN_AT_COMPACT.has(surface)) {
    return promoteToFullScreen(surface);
  }

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
        contentClassName: secondaryEditorClass,
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
