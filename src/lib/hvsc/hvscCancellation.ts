/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const HVSC_CANCELLATION_CODE = "HVSC_CANCELLED";

export type HvscCancellationError = Error & {
  code: typeof HVSC_CANCELLATION_CODE;
  isCancellation: true;
};

export const createHvscCancellationError = (message = "HVSC update cancelled"): HvscCancellationError =>
  Object.assign(new Error(message), {
    code: HVSC_CANCELLATION_CODE,
    isCancellation: true as const,
  });

export const isHvscCancellationError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; isCancellation?: unknown; name?: unknown };
  return (
    candidate.code === HVSC_CANCELLATION_CODE ||
    candidate.isCancellation === true ||
    candidate.name === "AbortError"
  );
};
