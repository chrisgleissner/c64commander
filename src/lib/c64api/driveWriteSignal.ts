/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { forgetPlayLaunchMount } from "@/lib/playback/playLaunchMountStore";

/**
 * A drive mount or eject went through the API, so the drive no longer holds what Play put there. This clears the
 * saved record directly, even before the Play page has loaded, so a Stop in a later session cannot eject it.
 */
export const signalDriveWritten = (deviceHost: string, drive: string) => forgetPlayLaunchMount(deviceHost, drive);
