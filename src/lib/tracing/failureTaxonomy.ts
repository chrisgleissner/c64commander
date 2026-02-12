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

export type FailureClass =
  | 'user-cancellation'
  | 'network-transient'
  | 'network-unreachable'
  | 'io-read-failure'
  | 'io-write-failure'
  | 'parse-failure'
  | 'metadata-absent'
  | 'permission-denied'
  | 'resource-exhausted'
  | 'plugin-failure'
  | 'playback-device-error'
  | 'unknown';

export type FailureClassification = {
  category: FailureCategory;
  isExpected: boolean;
  errorType: string | null;
  failureClass: FailureClass;
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

const isPermissionError = (message: string) =>
  /permission denied|permission rejected|not allowed|securityexception|notallowederror|operation not permitted|ep[er]m/i.test(message);

const isWriteError = (message: string) =>
  /write|saving|persist|store|mkdir|create|overwrite|cannot write|failed to write/i.test(message);

const isParseError = (error: Error, message: string) =>
  error.name === 'SyntaxError' || /parse|malformed|invalid (json|yaml|format)|unexpected token/i.test(message);

const isMetadataAbsentError = (message: string) =>
  /not found|missing|no songlength|no duration|metadata.*absent/i.test(message);

const isDevicePlaybackError = (message: string) =>
  /sidplay|runner|c64u|device.*error|playback.*failed/i.test(message);

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

  let failureClass: FailureClass = 'unknown';
  if (isAbortError(err, message)) {
    failureClass = 'user-cancellation';
  } else if (isPermissionError(message)) {
    failureClass = 'permission-denied';
  } else if (isTimeoutError(message)) {
    failureClass = 'network-transient';
  } else if (isNetworkError(message)) {
    failureClass = /unknown host|enotfound|dns|unreachable|ehostunreach|enetunreach/i.test(message)
      ? 'network-unreachable'
      : 'network-transient';
  } else if (err.name === 'QuotaExceededError' || /no space|out of memory|oom|resource exhausted|insufficient storage/i.test(message)) {
    failureClass = 'resource-exhausted';
  } else if (isParseError(err, message)) {
    failureClass = 'parse-failure';
  } else if (isIntegrationError(message)) {
    failureClass = 'plugin-failure';
  } else if (isWriteError(message)) {
    failureClass = 'io-write-failure';
  } else if (err instanceof LocalSourceListingError) {
    failureClass = err.code.startsWith('saf-') ? 'permission-denied' : 'io-read-failure';
  } else if (isStorageError(err, message)) {
    failureClass = isWriteError(message) ? 'io-write-failure' : 'io-read-failure';
  } else if (isMetadataAbsentError(message)) {
    failureClass = 'metadata-absent';
  } else if (isDevicePlaybackError(message)) {
    failureClass = 'playback-device-error';
  }

  return {
    category,
    isExpected,
    errorType: resolveErrorType(err),
    failureClass,
  };
};
