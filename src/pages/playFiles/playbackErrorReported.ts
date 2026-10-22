/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type HandledUiError = Error & { c64uHandled?: boolean };

export const markHandledUiError = (error: unknown) => {
  if (error instanceof Error) {
    (error as HandledUiError).c64uHandled = true;
  }
};

export const isHandledUiError = (error: unknown): error is HandledUiError =>
  error instanceof Error && Boolean((error as HandledUiError).c64uHandled);
