/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isAbortLikeError } from "@/lib/c64api/requestRuntime";
import { reportUserError } from "@/lib/uiErrors";
import { isPlaybackErrorReported } from "@/pages/playFiles/playbackErrorReported";

/**
 * A foreground play start that is superseded or aborted by a routing change still gives the user feedback,
 * but as a notice rather than a destructive error: the device target changed mid-start, so "press Play
 * again" is the correct recovery (ERROR_POLICY §2 vs §3 boundary).
 */
export const reportPlaybackStartFailure = (report: {
  operation: string;
  title: string;
  error: unknown;
  context?: Record<string, unknown>;
}) => {
  if (isPlaybackErrorReported(report.error)) return;
  if (isAbortLikeError(report.error)) {
    reportUserError({
      operation: report.operation,
      title: "Playback interrupted",
      description: "The connection changed while starting playback. Press Play again.",
      error: report.error,
      context: report.context,
      severity: "S2",
    });
    return;
  }
  reportUserError({
    operation: report.operation,
    title: report.title,
    description: (report.error as Error).message,
    error: report.error,
    context: report.context,
  });
};
