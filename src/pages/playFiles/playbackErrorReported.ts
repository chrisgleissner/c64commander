/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type PlaybackReportedError = Error & { c64uHandled?: boolean };

export const markPlaybackErrorReported = (error: unknown) => {
  if (error instanceof Error) {
    (error as PlaybackReportedError).c64uHandled = true;
  }
};

export const isPlaybackErrorReported = (error: unknown): error is PlaybackReportedError =>
  error instanceof Error && Boolean((error as PlaybackReportedError).c64uHandled);
