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
  }) as HvscCancellationError;

export const isHvscCancellationError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; isCancellation?: unknown; name?: unknown; message?: unknown };
  if (
    candidate.code === HVSC_CANCELLATION_CODE ||
    candidate.isCancellation === true ||
    candidate.name === "AbortError"
  ) {
    return true;
  }
  // A cancellation raised behind the native HVSC bridge (or any structured-clone
  // boundary) arrives as a plain Error: the marker props are stripped and only the
  // message survives. Fall back to matching the app's own cancellation messages
  // ("HVSC update cancelled", "Cancelled") — which all end in "cancelled" — so a
  // user-initiated cancel is never surfaced as a failure toast. The match is
  // anchored to the end so an incidental network failure that merely mentions the
  // word (e.g. "cancelled by network peer") still surfaces as a real failure.
  return typeof candidate.message === "string" && /cancell?ed\.?$/i.test(candidate.message.trim());
};

/**
 * What the HVSC card shows as the reason after the user stops a running install.
 * `edge-hvsc-repeat-cancel-resume` waits for this exact string, and `maestroFlowContracts` checks
 * the flow's wait text against it, so a rename fails that test instead of leaving the flow
 * waiting for text nothing renders.
 */
export const HVSC_CANCELED_STATUS_REASON = "Canceled";
