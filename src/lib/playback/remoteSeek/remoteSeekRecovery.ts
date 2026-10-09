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
import { hasRemoteSeekJournal, recoverRemoteSeekJournal } from "./remoteSeekDeviceGuard";

/** Reconnecting re-routes the API a moment after the state changes, which aborts a request sent at once. */
const RECOVERY_SETTLE_MS = 1500;

let recovering = false;

const recoverWhenConnected = async () => {
  if (recovering || !hasRemoteSeekJournal()) return;
  recovering = true;
  try {
    await new Promise((resolve) => setTimeout(resolve, RECOVERY_SETTLE_MS));
    if (getConnectionSnapshot().state !== "REAL_CONNECTED" || isSimulatedDeviceTarget()) return;
    await recoverRemoteSeekJournal(createRemoteSeekApi());
  } catch (error) {
    addErrorLog("Remote seek recovery failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    recovering = false;
  }
};

/**
 * Undo a remote seek an earlier session left unfinished — the app was killed, the connection
 * dropped or the phone slept mid-seek — whenever the app reaches a real device. The journal names
 * the device, so a different device is never touched.
 */
export const installRemoteSeekRecovery = () => {
  let previous = getConnectionSnapshot().state;
  if (previous === "REAL_CONNECTED") void recoverWhenConnected();
  return subscribeConnection(() => {
    const { state } = getConnectionSnapshot();
    const was = previous;
    previous = state;
    if (state === "REAL_CONNECTED" && was !== state) void recoverWhenConnected();
  });
};
