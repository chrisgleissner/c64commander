/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  getConnectionSnapshot,
  isSimulatedDeviceTarget,
  subscribeConnection,
} from "@/lib/connection/connectionManager";
import { addErrorLog } from "@/lib/logging";
import { createRemoteSeekApi } from "./activeRemoteSidSeek";
import { hasRemoteSeekJournal, onRemoteSeekRestoreFailed, recoverRemoteSeekJournal } from "./remoteSeekDeviceGuard";
import { remoteSeekErrorDetails } from "./remoteSeekErrors";

/** Reconnecting re-routes the API a moment after the state changes, which aborts a request sent at once. */
const RECOVERY_SETTLE_MS = 1500;

/** A restore that failed while the app stays connected is tried again after these delays, then left to the next connection. */
export const RECOVERY_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000] as const;

let recovering = false;
/** A connection made while a recovery ran, which may be to the device that owes the journal. */
let connectedDuringRecovery = false;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const recoverWhenConnected = async () => {
  if (recovering) {
    connectedDuringRecovery = true;
    return;
  }
  if (!hasRemoteSeekJournal()) return;
  recovering = true;
  let restored = true;
  try {
    await new Promise((resolve) => setTimeout(resolve, RECOVERY_SETTLE_MS));
    if (getConnectionSnapshot().state !== "REAL_CONNECTED" || isSimulatedDeviceTarget()) return;
    restored = await recoverRemoteSeekJournal(createRemoteSeekApi());
  } catch (error) {
    restored = false;
    addErrorLog("Remote seek recovery failed", remoteSeekErrorDetails(error));
  } finally {
    recovering = false;
  }
  if (connectedDuringRecovery) {
    connectedDuringRecovery = false;
    void recoverWhenConnected();
  } else if (!restored) {
    retryLater();
  }
};

const retryLater = () => {
  const delayMs = RECOVERY_RETRY_DELAYS_MS[retries];
  if (retryTimer !== null || delayMs === undefined) return;
  retries += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void recoverWhenConnected();
  }, delayMs);
};

const forgetRetries = () => {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  retries = 0;
};

/**
 * Undo a remote seek an earlier session left unfinished — the app was killed, the connection
 * dropped or the phone slept mid-seek — whenever the app reaches a real device. The journal names
 * the device, so a different device is never touched.
 */
export const installRemoteSeekRecovery = () => {
  let previous = getConnectionSnapshot().state;
  if (previous === "REAL_CONNECTED") void recoverWhenConnected();
  const stopRetryingFailedRestores = onRemoteSeekRestoreFailed(retryLater);
  const unsubscribe = subscribeConnection(() => {
    const { state } = getConnectionSnapshot();
    const was = previous;
    previous = state;
    if (state === "REAL_CONNECTED" && was !== state) {
      forgetRetries();
      void recoverWhenConnected();
    }
  });
  return () => {
    unsubscribe();
    stopRetryingFailedRestores();
    forgetRetries();
  };
};
