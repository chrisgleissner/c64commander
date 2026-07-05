/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { KeyTone } from "@/lib/remoteInput/keyboardLayout";

/**
 * The shared "shape + colour, never colour alone" caution/danger affordance for
 * remote-input keys. Extracted so BOTH the Keys-tab keyboard (TypeKeyboard) and
 * the always-visible quick-keys bar (QuickKeysBar) render RUN/STOP and RESTORE
 * with the same warning treatment — HARD16-006: RUN/STOP must never look like an
 * ordinary key that halts the running program on a mistap.
 */
export const toneButtonClass = (tone: KeyTone | undefined, latched = false): string => {
  switch (tone) {
    case "danger":
      // RESTORE — shape (double solid border) + colour.
      return "border-2 border-destructive text-destructive font-semibold";
    case "caution":
      // RUN/STOP — shape (dashed border) + colour.
      return "border-2 border-dashed border-amber-500 text-amber-600 dark:border-amber-400 dark:text-amber-300";
    case "modifier":
      return latched ? "ring-2 ring-primary" : "";
    default:
      return "";
  }
};
