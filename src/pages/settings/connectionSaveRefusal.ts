/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { clearToastForSuccessfulOperation, reportUserError } from "@/lib/uiErrors";

export const CONNECTION_SAVE_REFUSED_OPERATION = "CONNECTION_SAVE_REFUSED";

export const clearConnectionSaveRefusal = (deviceHost: string): void =>
  clearToastForSuccessfulOperation(CONNECTION_SAVE_REFUSED_OPERATION, deviceHost);

/** Replaces the toast of an earlier refusal, so the screen never shows two reasons for one device. */
export const reportConnectionSaveRefused = (description: string, deviceHost: string): void => {
  clearConnectionSaveRefusal(deviceHost);
  reportUserError({
    operation: CONNECTION_SAVE_REFUSED_OPERATION,
    title: "Connection not saved",
    description,
    deviceHost,
  });
};
