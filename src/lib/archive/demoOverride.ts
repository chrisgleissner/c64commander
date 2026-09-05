/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * Where the online archive lives while Demo Mode is running.
 *
 * Session state, not a setting. The archive host a user has typed is a persisted preference, and
 * Demo Mode must not overwrite it: it is entered and left many times in a session, and a device
 * that ends up permanently pointed at a mock that is no longer listening is worse than one that
 * cannot reach the archive at all. This mirrors the FTP port and password overrides in
 * lib/ftp/ftpConfig.ts, which exist for the same reason.
 *
 * The token is the mock server's per-boot `X-Mock-Token`. The loopback servers refuse anything
 * that does not present it, so that another app on the device cannot read the simulated machine
 * (HARD10-005); the archive client is no exception and has to carry it too.
 */

export type ArchiveRuntimeOverride = {
  readonly host: string;
  readonly token: string | null;
};

let runtimeOverride: ArchiveRuntimeOverride | null = null;

export const setRuntimeArchiveOverride = (override: ArchiveRuntimeOverride | null) => {
  runtimeOverride = override?.host ? override : null;
};

export const clearRuntimeArchiveOverride = () => {
  runtimeOverride = null;
};

export const getRuntimeArchiveOverride = (): ArchiveRuntimeOverride | null => runtimeOverride;
