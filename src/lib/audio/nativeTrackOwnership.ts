/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Which sink holds the one native audio track, shared by the on-device SID engine and the Live View audio
 * mirror. A sink that a newer one has taken the track from must leave it alone, including when it closes.
 */

const trackOwners = new WeakMap<object, { sink: object; serial: number }>();
let nextSinkSerial = 1;

/** A sink's place in the order they were created. Later beats earlier. */
export const nextSerial = (): number => nextSinkSerial++;

/**
 * Take the track, if this sink is not already behind a newer one.
 *
 * Called from the write path rather than from the constructor, and ordered by age rather than by
 * who got there last. Both matter:
 *
 * - Claiming at construction silenced the outgoing tune the moment the incoming sink existed, which
 *   is a second or two before that tune has rendered anything — heard as a gap where the crossfade
 *   should be.
 * - Claiming unconditionally on write let the outgoing sink take the track straight back, so the
 *   two traded it and their slices interleaved.
 *
 * Ordering by serial gives the handover the app actually wants: the outgoing tail keeps the speaker
 * fed right up to the incoming tune's first sample, and from that sample on the older sink is
 * finished.
 */
export const claimNativeTrack = (backend: object, sink: object, serial: number): void => {
  const owner = trackOwners.get(backend);
  if (owner && owner.serial > serial) return;
  trackOwners.set(backend, { sink, serial });
};

/** Whether a NEWER sink has already begun writing, which is what retires this one. */
export const isSuperseded = (backend: object, serial: number): boolean => {
  const owner = trackOwners.get(backend);
  return owner !== undefined && owner.serial > serial;
};

export const releaseNativeTrack = (backend: object, sink: object): void => {
  if (trackOwners.get(backend)?.sink === sink) trackOwners.delete(backend);
};
