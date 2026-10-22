/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { toast } from "@/hooks/use-toast";
import { clearToastForSuccessfulOperation, reportUserError } from "@/lib/uiErrors";

const REFUSED_OPERATION = "CONNECTION_SAVE_REFUSED";
const FAILED_OPERATION = "CONNECTION_SAVE";
const REFUSED_TITLE = "Connection not saved";

const reportedHosts = new Set<string>();
let invalidDraftToast: { dismiss: () => void } | null = null;

/** Every outcome of a save replaces the toasts of the earlier ones, so the screen shows one reason at a time. */
export const dismissConnectionSaveToasts = (): void => {
  invalidDraftToast?.dismiss();
  invalidDraftToast = null;
  reportedHosts.forEach((host) => {
    clearToastForSuccessfulOperation(REFUSED_OPERATION, host);
    clearToastForSuccessfulOperation(FAILED_OPERATION, host);
  });
  reportedHosts.clear();
};

/** A typing mistake: the field shows it inline, so the toast is a notice that goes away by itself. */
export const reportInvalidConnectionDraft = (description: string): void => {
  dismissConnectionSaveToasts();
  invalidDraftToast = toast({ title: REFUSED_TITLE, description, alwaysVisible: true });
};

export const reportConnectionSaveRefused = (description: string, deviceHost: string): void => {
  dismissConnectionSaveToasts();
  reportedHosts.add(deviceHost);
  reportUserError({ operation: REFUSED_OPERATION, title: REFUSED_TITLE, description, deviceHost });
};

export const reportConnectionSaveFailed = (description: string, error: unknown, deviceHost: string): void => {
  dismissConnectionSaveToasts();
  reportedHosts.add(deviceHost);
  reportUserError({
    operation: FAILED_OPERATION,
    title: "Unable to save connection",
    description,
    error,
    deviceHost,
  });
};
