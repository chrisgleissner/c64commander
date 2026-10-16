/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";
import { shouldSyncBackgroundExecutionDueAt } from "@/pages/playFiles/backgroundExecutionPolicy";

/** Mirrors the auto-advance deadline to the native background watchdog on Android. */
export const useBackgroundDueAtSync = ({
  backgroundExecutionEnabled,
  backgroundExecutionActiveRef,
  isNativeAndroid,
  sessionRestoreSettled,
  autoAdvanceDueAtMs,
  queueBackgroundDueAtUpdate,
}: {
  backgroundExecutionEnabled: boolean;
  backgroundExecutionActiveRef: { readonly current: boolean };
  isNativeAndroid: boolean;
  sessionRestoreSettled: boolean;
  autoAdvanceDueAtMs: number | null;
  queueBackgroundDueAtUpdate: (dueAtMs: number | null) => Promise<void>;
}) => {
  useEffect(() => {
    const sync = shouldSyncBackgroundExecutionDueAt(
      backgroundExecutionEnabled,
      backgroundExecutionActiveRef.current,
      isNativeAndroid,
      sessionRestoreSettled,
    );
    if (sync) void queueBackgroundDueAtUpdate(autoAdvanceDueAtMs);
  }, [
    autoAdvanceDueAtMs,
    backgroundExecutionActiveRef,
    backgroundExecutionEnabled,
    isNativeAndroid,
    queueBackgroundDueAtUpdate,
    sessionRestoreSettled,
  ]);
};
