/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Whether the app is re-checking a connection it has just come back to.
 *
 * Nothing probes the device while the connection reads REAL_CONNECTED, so on return that state is
 * only as good as the last time the app spoke to the device: the badge claimed "system healthy"
 * about a machine that had been out of reach for an hour. The badge reports that it is checking
 * while this is set, and the probe that set it decides the answer.
 */
let revalidating = false;
const listeners = new Set<() => void>();

export const isRevalidatingConnection = (): boolean => revalidating;

export const subscribeConnectionRevalidation = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const set = (next: boolean) => {
  if (revalidating === next) return false;
  revalidating = next;
  listeners.forEach((listener) => listener());
  return true;
};

/** Returns false when a revalidation is already in flight, so callers do not start a second one. */
export const beginConnectionRevalidation = (): boolean => set(true);

export const endConnectionRevalidation = (): void => {
  set(false);
};
