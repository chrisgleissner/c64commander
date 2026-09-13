/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ConnectionState } from "@/lib/connection/connectionManager";
import type { HvscReleaseStatus } from "./hvscReleaseService";
import type { HvscLibrarySource, HvscState } from "./hvscStateStore";
import type { HvscUpdateStatus } from "./hvscTypes";

// Demo Mode's simulated device serves a release of invented tunes, and the app has one HVSC library.
// Every decision about which release may change that library is made in this module.

type LibraryFacts = Pick<HvscState, "installedVersion" | "installedBaselineVersion"> & {
  librarySource?: HvscLibrarySource;
};

/**
 * `keep-real-library`: a simulated release must never replace a real library, which is slow to reinstall.
 * `discard-demo-library`: a real release must not build on Demo Mode's library or its cached archives.
 */
export type HvscReleaseUse = "use" | "keep-real-library" | "discard-demo-library";

export const decideHvscReleaseUse = (library: LibraryFacts, simulatedRelease: boolean): HvscReleaseUse => {
  const demoData = library.librarySource === "demo";
  if (simulatedRelease) {
    return !demoData && (library.installedVersion ?? 0) > 0 ? "keep-real-library" : "use";
  }
  return demoData ? "discard-demo-library" : "use";
};

const versionsAfter = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i + 1);

/** What an update check reports, given the library and the release it found. */
export const resolveHvscUpdateStatus = (
  library: LibraryFacts,
  release: Pick<HvscReleaseStatus, "baselineVersion" | "updateVersion" | "simulated">,
): HvscUpdateStatus => {
  const releaseUse = decideHvscReleaseUse(library, release.simulated);
  if (releaseUse === "keep-real-library") {
    const installedVersion = library.installedVersion ?? 0;
    return {
      latestVersion: installedVersion,
      installedVersion,
      baselineVersion: library.installedBaselineVersion ?? null,
      requiredUpdates: [],
    };
  }
  // The install removes Demo Mode's library first, so the real release is offered as a fresh install.
  const installedVersion = releaseUse === "discard-demo-library" ? 0 : (library.installedVersion ?? 0);
  const { baselineVersion, updateVersion } = release;
  const requiredUpdates =
    installedVersion === 0 && updateVersion > baselineVersion
      ? versionsAfter(baselineVersion, updateVersion)
      : installedVersion > 0 && installedVersion < updateVersion
        ? versionsAfter(installedVersion, updateVersion)
        : [];
  return { latestVersion: updateVersion, installedVersion, baselineVersion, requiredUpdates };
};

const SETTLED_OUTSIDE_DEMO_MODE: ReadonlySet<ConnectionState> = new Set(["REAL_CONNECTED", "OFFLINE_NO_DEMO"]);

/**
 * Whether Demo Mode's HVSC data has to be removed now. `UNKNOWN`/`DISCOVERING` may still end in Demo Mode.
 * The release must also no longer be served: the smoke-test mock reports `REAL_CONNECTED` while serving it,
 * and a real connection is announced before the demo server stops. Never while an install or ingest runs.
 */
export const shouldRemoveDemoLibrary = (input: {
  connectionState: ConnectionState;
  simulatedReleaseActive: boolean;
  librarySource: HvscLibrarySource | undefined;
  ingestionActive: boolean;
}): boolean =>
  input.librarySource === "demo" &&
  SETTLED_OUTSIDE_DEMO_MODE.has(input.connectionState) &&
  !input.simulatedReleaseActive &&
  !input.ingestionActive;
