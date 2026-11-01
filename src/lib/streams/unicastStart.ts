/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { StreamUdp } from "@/lib/native/streamUdp";

export const UNICAST_START_ATTEMPTS = 4;
export const UNICAST_RETRY_DELAY_MS = 300;

/** The firmware's answer when it could not find the destination's hardware address in time. */
export const isHostResolveError = (error: unknown): boolean =>
  /Network Host Resolve Error/i.test(error instanceof Error ? error.message : String(error));

/** A group from 224.0.0.0 to 239.255.255.255 is sent to every listener and needs no address lookup. */
export const isMulticastDestination = (destination: string): boolean => {
  const first = Number(destination.split(".")[0]);
  return Number.isInteger(first) && first >= 224 && first <= 239;
};

/**
 * Ask the Ultimate for a stream, and ask again when it could not find this phone.
 *
 * To send to one host the Ultimate sends a probe and looks in its ARP table for about 200 ms, so a
 * phone whose radio was dozing is not found and the request fails with "Network Host Resolve Error".
 * `makeReady` puts the phone in the table (ICMP echoes) and keeps its radio awake; the failed request
 * has also made the Ultimate probe it, so the next attempt usually succeeds. Any other error, and a
 * multicast destination, is passed through untouched.
 */
export const startStreamResolvingHost = async <T>(
  start: () => Promise<T>,
  destination: string,
  makeReady: () => Promise<void>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> => {
  if (isMulticastDestination(destination)) return start();
  for (let attempt = 1; ; attempt++) {
    try {
      return await start();
    } catch (error) {
      if (!isHostResolveError(error) || attempt >= UNICAST_START_ATTEMPTS) throw error;
      addLog("warn", "The Ultimate could not find this phone yet; trying again", { destination, attempt });
      await makeReady();
      await sleep(UNICAST_RETRY_DELAY_MS);
    }
  }
};

/** Make the Ultimate able to find this phone, ignoring a phone that has no native receiver. */
export const makeUnicastPathReady = async (host: string): Promise<void> => {
  try {
    await StreamUdp.prepareUnicast({ host });
  } catch (error) {
    addLog("warn", "Could not make this phone findable by the Ultimate", {
      host,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
