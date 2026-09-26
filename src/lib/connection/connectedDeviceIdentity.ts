/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// The unique id the really-connected device last reported, kept apart from the connection manager so
// a lightweight module can read it without loading the connection manager and its start-up work.
let connectedUniqueId: string | null = null;

export const setConnectedDeviceUniqueId = (uniqueId: string | null | undefined): void => {
  connectedUniqueId = uniqueId?.trim() || null;
};

export const getConnectedDeviceUniqueId = (): string | null => connectedUniqueId;
