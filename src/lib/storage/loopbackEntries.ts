/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const LOOPBACK_ADDRESS = /^(?:https?:\/\/)?(?:127\.\d+\.\d+\.\d+|localhost|\[::1\])(?::\d+)?\/?$/i;

export const isLoopbackAddress = (value: string) => LOOPBACK_ADDRESS.test(value.trim());

/**
 * The simulated device listens on a new loopback port every Demo Mode session, so anything stored per address
 * for an earlier port can never be read again. Called when an entry is written for a loopback address, it
 * removes the entries with the same prefix for every other loopback address.
 */
export const removeOtherLoopbackEntries = (prefix: string, keepKey: string) => {
  if (typeof localStorage === "undefined") return;
  const stale: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix) && key !== keepKey && isLoopbackAddress(key.slice(prefix.length))) stale.push(key);
  }
  stale.forEach((key) => localStorage.removeItem(key));
};
