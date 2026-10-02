/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type DriveWriteListener = (deviceHost: string, drive: string) => void;

const MAX_PENDING_SIGNALS = 32;
let listener: DriveWriteListener | null = null;
const pending: Array<[string, string]> = [];

/**
 * A drive mount or eject went through the API. Kept apart from what listens, so the startup bundle
 * does not carry the Play-page launch-mount store; writes made before it loads are handed over.
 */
export const signalDriveWritten = (deviceHost: string, drive: string) => {
  if (listener) {
    listener(deviceHost, drive);
    return;
  }
  pending.push([deviceHost, drive]);
  if (pending.length > MAX_PENDING_SIGNALS) pending.shift();
};

export const onDriveWritten = (next: DriveWriteListener) => {
  listener = next;
  pending.splice(0).forEach(([deviceHost, drive]) => next(deviceHost, drive));
};
