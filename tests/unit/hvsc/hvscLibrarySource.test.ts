/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import type { ConnectionState } from "@/lib/connection/connectionManager";
import { decideHvscReleaseUse, resolveHvscUpdateStatus, shouldRemoveDemoLibrary } from "@/lib/hvsc/hvscLibrarySource";

const realLibrary = { installedVersion: 83, installedBaselineVersion: 83, librarySource: "real" as const };
const demoLibrary = { installedVersion: 84, installedBaselineVersion: 84, librarySource: "demo" as const };
const noLibrary = { installedVersion: 0, installedBaselineVersion: null, librarySource: "real" as const };

describe("decideHvscReleaseUse", () => {
  it("keeps an installed real library when the release is Demo Mode's simulated one", () => {
    expect(decideHvscReleaseUse(realLibrary, true)).toBe("keep-real-library");
  });

  it("lets the simulated release install when no library, or only Demo Mode's library, is installed", () => {
    expect(decideHvscReleaseUse(noLibrary, true)).toBe("use");
    expect(decideHvscReleaseUse(demoLibrary, true)).toBe("use");
  });

  it("discards Demo Mode's data before a real release installs, even when no library completed", () => {
    expect(decideHvscReleaseUse(demoLibrary, false)).toBe("discard-demo-library");
    expect(decideHvscReleaseUse({ ...noLibrary, librarySource: "demo" }, false)).toBe("discard-demo-library");
  });

  it("lets a real release update a real library", () => {
    expect(decideHvscReleaseUse(realLibrary, false)).toBe("use");
  });

  it("treats a library without a recorded source as real", () => {
    const legacy = { installedVersion: 83, installedBaselineVersion: 83 };
    expect(decideHvscReleaseUse(legacy, true)).toBe("keep-real-library");
    expect(decideHvscReleaseUse(legacy, false)).toBe("use");
  });
});

describe("resolveHvscUpdateStatus", () => {
  it("offers no update from the simulated release to a real library that is older than it", () => {
    const status = resolveHvscUpdateStatus(realLibrary, { baselineVersion: 84, updateVersion: 84, simulated: true });

    expect(status).toEqual({ latestVersion: 83, installedVersion: 83, baselineVersion: 83, requiredUpdates: [] });
  });

  it("offers the real release as a fresh install over Demo Mode's library", () => {
    const status = resolveHvscUpdateStatus(demoLibrary, { baselineVersion: 83, updateVersion: 85, simulated: false });

    expect(status).toEqual({ latestVersion: 85, installedVersion: 0, baselineVersion: 83, requiredUpdates: [84, 85] });
  });

  it("lists the updates a real library is missing from a real release", () => {
    const status = resolveHvscUpdateStatus(realLibrary, { baselineVersion: 82, updateVersion: 85, simulated: false });

    expect(status.requiredUpdates).toEqual([84, 85]);
    expect(status.installedVersion).toBe(83);
  });
});

describe("shouldRemoveDemoLibrary", () => {
  const settled = (
    connectionState: ConnectionState,
    overrides: Partial<Parameters<typeof shouldRemoveDemoLibrary>[0]> = {},
  ) =>
    shouldRemoveDemoLibrary({
      connectionState,
      simulatedReleaseActive: false,
      librarySource: "demo",
      ingestionActive: false,
      ...overrides,
    });

  it.each<ConnectionState>(["REAL_CONNECTED", "OFFLINE_NO_DEMO"])(
    "removes Demo Mode's library once the connection settles on %s",
    (state) => {
      expect(settled(state)).toBe(true);
    },
  );

  it.each<ConnectionState>(["UNKNOWN", "DISCOVERING", "DEMO_ACTIVE"])("keeps Demo Mode's library while %s", (state) => {
    expect(settled(state)).toBe(false);
  });

  it("keeps it while the simulated release is still served, as by the smoke-test mock connection", () => {
    expect(settled("REAL_CONNECTED", { simulatedReleaseActive: true })).toBe(false);
  });

  it("keeps it while an install or ingest is running", () => {
    expect(settled("REAL_CONNECTED", { ingestionActive: true })).toBe(false);
  });

  it("never removes a real library, or one stored without a source", () => {
    expect(settled("REAL_CONNECTED", { librarySource: "real" })).toBe(false);
    expect(settled("OFFLINE_NO_DEMO", { librarySource: undefined })).toBe(false);
  });
});
