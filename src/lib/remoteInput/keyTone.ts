/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cn } from "@/lib/utils";
import type { KeyTone } from "@/lib/remoteInput/keyboardLayout";

/**
 * The shared colour treatment for remote-input keys. Extracted so BOTH the
 * Keys-tab keyboard (TypeKeyboard) and the always-visible quick-keys bar
 * (QuickKeysBar) render the danger/caution keys with the same warning treatment
 * — HARD16-006: RUN/STOP must never look like an ordinary key that halts the
 * running program on a mistap. Also colours the ordinary typing keys and the
 * SHIFT family so the Keys tab reads at a glance.
 */
export const toneButtonClass = (tone: KeyTone | undefined, latched = false): string => {
  switch (tone) {
    case "danger":
      // RESTORE — shape (double solid ring, D10: box-shadow inset, never
      // border-width) + colour. Explicit red-400 in dark mode so the label
      // stays legible: --destructive's dark value is tuned for white text on
      // a --destructive *background* (a delete button), which pulls it too
      // dark to also work as *text* on this button's --secondary surface —
      // lightening the shared token to fix one role would break the other.
      return "shadow-[inset_0_0_0_2px_theme(colors.red.500)] text-red-600 dark:shadow-[inset_0_0_0_2px_theme(colors.red.400)] dark:text-red-300 font-semibold";
    case "caution":
      // RUN/STOP — shape (solid double ring, like RESTORE's "danger" tone)
      // + colour, using the theme's own warning token instead of a one-off
      // dashed/raw-amber treatment. Explicit amber-400/300 in dark mode for
      // the same reason as `danger` above: --warning's dark value is not
      // tuned for use as text on this button's --secondary surface.
      return "shadow-[inset_0_0_0_2px_hsl(var(--warning))] text-warning dark:shadow-[inset_0_0_0_2px_theme(colors.amber.400)] dark:text-amber-300 font-semibold";
    case "shift":
      // SHIFT / SHIFT LOCK — the app's primary blue (same token the rest of
      // the UI uses for emphasis), distinct from the plain C=/CTRL modifiers
      // via an always-on ring/fill (D10: box-shadow inset, never
      // border-width); a ring marks the latched (active) state.
      return cn(
        "shadow-[inset_0_0_0_2px_hsl(var(--primary))] bg-primary/10 text-primary font-bold",
        latched && "ring-2 ring-primary",
      );
    case "character":
      // Ordinary typing keys (0-9, A-Z) — a calm sky tint that sets them apart
      // from the symbol and system keys.
      return "border-key-character-border bg-key-character-surface text-key-character-foreground";
    case "function-primary":
      // f 1 / f 3 / f 5 / f 7 — the primary (unshifted, front-labelled) function
      // keys, given a slightly darker neutral fill so they stand apart from the
      // shifted f 2 / f 4 / f 6 / f 8, echoing the subtle tint on the typing keys.
      return "border-key-function-border bg-key-function-surface text-key-function-foreground";
    case "modifier":
      return latched ? "ring-2 ring-primary" : "";
    default:
      return "";
  }
};
