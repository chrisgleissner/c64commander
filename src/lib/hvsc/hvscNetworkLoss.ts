/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { toast } from "@/hooks/use-toast";
import { isNetworkKnownOffline } from "@/lib/connection/networkStatusWatch";
import { readNativeNetworkStatus } from "@/lib/connection/offlineStartup";
import { addLog } from "@/lib/logging";
import { reportUserError } from "@/lib/uiErrors";
import { isHvscCancellationError } from "./hvscCancellation";
import { HVSC_NO_NETWORK_MESSAGE } from "./hvscReleaseService";

/** The reject code the native download uses when the transfer died because the phone lost its network. */
const NETWORK_LOST_CODE = "NETWORK_LOST";

export const isHvscNoNetworkError = (error: unknown) =>
  error instanceof Error && error.message === HVSC_NO_NETWORK_MESSAGE;

/**
 * A download cut off by the phone leaving its Wi-Fi arrived as the socket's own words
 * ("Software caused connection abort"). Restating it as the no-network failure lets the
 * callers treat it as the phone's state rather than as a fault.
 */
export const explainHvscDownloadFailure = async (error: unknown): Promise<unknown> => {
  if (isHvscCancellationError(error) || isHvscNoNetworkError(error)) return error;
  if ((error as { code?: unknown } | null)?.code !== NETWORK_LOST_CODE) {
    await readNativeNetworkStatus();
    if (!isNetworkKnownOffline()) return error;
  }
  return new Error(HVSC_NO_NETWORK_MESSAGE, { cause: error });
};

export const reportHvscDownloadFailure = (error: Error) => {
  if (!isHvscNoNetworkError(error)) {
    reportUserError({ operation: "HVSC_DOWNLOAD", title: "HVSC update failed", description: error.message, error });
    return;
  }
  addLog("info", "HVSC download stopped: no network", { error: error.message });
  toast({ title: "HVSC download stopped", description: HVSC_NO_NETWORK_MESSAGE, alwaysVisible: true });
};
