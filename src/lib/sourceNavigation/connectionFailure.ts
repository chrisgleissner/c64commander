/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isTransientConnectivityFailure } from "@/lib/uiErrors";

/** What a failed device listing says when the device or the network is gone. */
const LOST_CONNECTION_PATTERN =
  /timed out|timeout|unable to resolve host|connection reset|connection abort|software caused|no route to host|network is unreachable|enetunreach|broken pipe/i;

export const isConnectionFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return LOST_CONNECTION_PATTERN.test(message) || isTransientConnectivityFailure(message);
};
