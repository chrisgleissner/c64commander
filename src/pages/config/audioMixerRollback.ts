/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type NamedItem = { name: string };

/**
 * Undoes one failed Audio Mixer write: restores only `itemName` from the list taken before that
 * write. Restoring the whole earlier list would also undo a newer change to another item that was
 * made while this write was in flight.
 */
export const rollbackAudioMixerItem = <T extends NamedItem>(current: T[], before: T[], itemName: string): T[] => {
  const previous = before.find((item) => item.name === itemName);
  if (!previous || current.length === 0) return before;
  return current.map((item) => (item.name === itemName ? previous : item));
};
