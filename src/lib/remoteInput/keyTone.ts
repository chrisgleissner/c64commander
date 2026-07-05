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
      // RESTORE — shape (double solid border) + colour. Explicit red-400 in dark
      // mode so the label stays legible (the theme's `destructive` is too dark).
      return "border-2 border-red-500 text-red-600 dark:border-red-400 dark:text-red-300 font-semibold";
    case "caution":
      // RUN/STOP — shape (dashed border) + colour.
      return "border-2 border-dashed border-amber-500 text-amber-600 dark:border-amber-400 dark:text-amber-300";
    case "shift":
      // SHIFT / SHIFT LOCK — their own high-visibility violet, distinct from the
      // C=/CTRL modifiers; a ring marks the latched (active) state.
      return cn(
        "border-2 border-violet-500 bg-violet-500/10 text-violet-700 dark:border-violet-400 dark:text-violet-200 font-bold",
        latched && "ring-2 ring-violet-500",
      );
    case "character":
      // Ordinary typing keys (0-9, A-Z) — a calm sky tint that sets them apart
      // from the symbol and system keys.
      return "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-100";
    case "function-primary":
      // f 1 / f 3 / f 5 / f 7 — the primary (unshifted, front-labelled) function
      // keys, given a slightly darker neutral fill so they stand apart from the
      // shifted f 2 / f 4 / f 6 / f 8, echoing the subtle tint on the typing keys.
      return "border-slate-400 bg-slate-300 text-slate-900 dark:border-slate-500 dark:bg-slate-600 dark:text-slate-50";
    case "modifier":
      return latched ? "ring-2 ring-primary" : "";
    default:
      return "";
  }
};
