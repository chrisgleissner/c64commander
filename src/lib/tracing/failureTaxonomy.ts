/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { LocalSourceListingError } from '@/lib/sourceNavigation/localSourceErrors';

export type FailureCategory =
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'user'
  | 'integration'
  | 'storage'
  | 'unknown';

export type FailureClassification = {
  category: FailureCategory;
  isExpected: boolean;
  errorType: string | null;
};

const normalizeMessage = (error: unknown) => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }
  return '';
};

const isAbortError = (error: Error, message: string) =>
  error.name === 'AbortError' || /aborted|canceled|cancelled/i.test(message);

const isTimeoutError = (message: string) => /timed out|timeout/i.test(message);

const isNetworkError = (message: string) =>
  /failed to fetch|networkerror|network request failed|unknown host|enotfound|dns|offline|econn|socket/i.test(message);

const isUserError = (message: string) =>
  /no file selected|no directory selected|selection canceled|selection cancelled|permission rejected|permission denied/i.test(message);

const isStorageError = (error: Error, message: string) =>
  error.name === 'QuotaExceededError'
  || /storage|filesystem|file system|no such file|not found/i.test(message);

const isIntegrationError = (message: string) =>
  /plugin|bridge|capacitor|native/i.test(message);

const resolveErrorType = (error: Error) => {
  if (error instanceof LocalSourceListingError) {
    return `LocalSourceListingError:${error.code}`;
  }
  if (error.name && error.name !== 'Error') return error.name;
  return null;
};

export const classifyError = (error: unknown, categoryHint?: FailureCategory): FailureClassification => {
  const err = error instanceof Error ? error : new Error(normalizeMessage(error) || 'Unknown error');
  const message = normalizeMessage(err).toLowerCase();

  let category: FailureCategory = categoryHint ?? 'unknown';

  if (!categoryHint) {
    if (isAbortError(err, message)) {
      category = 'cancelled';
    } else if (isTimeoutError(message)) {
      category = 'timeout';
    } else if (isNetworkError(message)) {
      category = 'network';
    } else if (err instanceof LocalSourceListingError || isStorageError(err, message)) {
      category = 'storage';
    } else if (isUserError(message)) {
      category = 'user';
    } else if (isIntegrationError(message)) {
      category = 'integration';
    }
  }

  const isExpected = category === 'cancelled' || category === 'user';

  return {
    category,
    isExpected,
    errorType: resolveErrorType(err),
  };
};
