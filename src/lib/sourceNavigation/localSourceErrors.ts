/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type LocalSourceListingErrorCode =
  | 'saf-listing-unavailable'
  | 'saf-listing-invalid'
  | 'local-entries-missing';

type LocalSourceListingErrorDetails = Record<string, unknown>;

export class LocalSourceListingError extends Error {
  readonly code: LocalSourceListingErrorCode;
  readonly details?: LocalSourceListingErrorDetails;

  constructor(message: string, code: LocalSourceListingErrorCode, details?: LocalSourceListingErrorDetails) {
    super(message);
    this.name = 'LocalSourceListingError';
    this.code = code;
    this.details = details;
  }
}
