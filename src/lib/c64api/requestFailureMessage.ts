/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Includes Android's "Unable to resolve host", which CapacitorHttp reports for
// an unresolvable device hostname and which the other patterns do not match.
export const isDnsFailure = (message: string) =>
  /unknown host|enotfound|ename_not_found|dns|unable to resolve host/i.test(message);

export const isNetworkFailureMessage = (message: string) =>
  /failed to fetch|networkerror|network request failed|unknown host|enotfound|ename_not_found|dns|unable to resolve host/i.test(
    message,
  );

export const resolveHostErrorMessage = (message: string) =>
  isDnsFailure(message) ? "Host unreachable (DNS)" : "Host unreachable";

/** Shared by every consumer that classifies a request that got no answer in time as a connectivity failure. */
export const DEVICE_NO_ANSWER_PHRASE = "did not answer within";

const formatDuration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${Number((ms / 1000).toFixed(1))} s`);

/**
 * The message for a REST request that failed without a response. A request that ran out of time
 * reached a device that may be healthy but busy, so it names the time limit; only a failure the
 * network layer reported is "Host unreachable".
 */
export const resolveTransportFailureMessage = (
  rawMessage: string,
  timeout: { timedOut: boolean; timeoutMs: number | undefined },
) =>
  timeout.timedOut && timeout.timeoutMs !== undefined && !isNetworkFailureMessage(rawMessage)
    ? `The C64 ${DEVICE_NO_ANSWER_PHRASE} ${formatDuration(timeout.timeoutMs)}`
    : resolveHostErrorMessage(rawMessage);
