/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Last guard keeping seek keys to the SID player: elsewhere left-arrow, minus and plus type into whatever runs, BASIC
 * included, and a held key repeats. A press needs a permit for one key on one device, granted by the seek session right
 * after it saw the player's clock on screen and expiring within half a second; any other press is refused here.
 */

import type { MachineInputBatch } from "@/lib/c64api";

export const SEEK_KEYS: readonly string[] = ["arrow_left", "minus", "plus"];
const PERMIT_MS = 500;

/** One entry per confirmed press: two sessions may each confirm before either sends. */
let permits: Array<{ deviceKey: string; key: string; until: number }> = [];

export class SeekKeyRefusedError extends Error {}

/** Allow one press of `key` on `deviceKey`, now that the SID player has been seen on its screen. */
export const grantSeekKeyPress = (deviceKey: string, key: string) => {
  permits.push({ deviceKey, key, until: Date.now() + PERMIT_MS });
};

/** Use up the permit for this press; a press without one also voids every other permit for the device. */
const takePermit = (deviceKey: string | null, key: string) => {
  const now = Date.now();
  permits = permits.filter((permit) => permit.until >= now);
  const index = permits.findIndex((permit) => permit.deviceKey === deviceKey && permit.key === key);
  if (index < 0) {
    permits = permits.filter((permit) => permit.deviceKey !== deviceKey);
    return false;
  }
  permits.splice(index, 1);
  return true;
};

/**
 * `send`, refusing any batch that presses a seek key without a permit for it. Releases always pass:
 * letting a key go is never harmful, and the restore depends on it.
 */
export const withSeekKeyPermits =
  <T>(send: (batch: MachineInputBatch) => Promise<T>, deviceKey: () => string | null) =>
  async (batch: MachineInputBatch): Promise<T> => {
    for (const event of batch.events) {
      if (event.kind !== "keyboard" || event.transition === "release") continue;
      for (const key of event.inputs.filter((input) => SEEK_KEYS.includes(input))) {
        if (!takePermit(deviceKey(), key)) {
          throw new SeekKeyRefusedError(`${key} was not sent: the SID player was not confirmed on screen first`);
        }
      }
    }
    return send(batch);
  };
