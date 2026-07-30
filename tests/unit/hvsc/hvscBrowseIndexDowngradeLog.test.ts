/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A library too large for a full snapshot is a *state*, not an event.
 *
 * Metadata hydration saves the browse index every five seconds for as long as it runs, and the
 * store used to announce the downgrade on every one of those saves. On a real 61k-song HVSC that
 * filled 313 of the diagnostics log's 500 entries with the same sentence and pushed out everything
 * worth reading — measured on a Pixel 4, and exactly when a user reporting a problem needs the log
 * most. Announce the transition, and again if a library ever comes back under the limit.
 *
 * Its own file because that memory is process-lifetime state: sharing a module instance with the
 * rest of the store's tests would make this pass or fail on test order.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    stat: vi.fn(async () => ({ type: "file", size: 1 })),
    mkdir: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => {
      throw new Error("missing");
    }),
    writeFile: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

import { addLog } from "@/lib/logging";
import { buildHvscBrowseIndexFromEntries, saveHvscBrowseIndexSnapshot } from "@/lib/hvsc/hvscBrowseIndexStore";

const DOWNGRADE_MESSAGE = "HVSC browse snapshot persistence downgraded to compact media index";

/** Above MAX_PERSISTED_FULL_SNAPSHOT_SONGS, so persistence falls back to the compact index. */
const hugeLibrary = () =>
  buildHvscBrowseIndexFromEntries(
    Array.from({ length: 10_001 }, (_, index) => ({
      path: `/HVSC/${index.toString().padStart(5, "0")}/Track_${index}.sid`,
      name: `Track_${index}.sid`,
      type: "sid" as const,
    })),
  );

/** Comfortably under the limit, so the full snapshot is written again. */
const smallLibrary = () =>
  buildHvscBrowseIndexFromEntries([
    { path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", name: "Commando.sid", type: "sid" as const },
  ]);

const downgradeLogCount = () =>
  vi.mocked(addLog).mock.calls.filter(([, message]) => message === DOWNGRADE_MESSAGE).length;

beforeEach(() => {
  vi.mocked(addLog).mockClear();
});

describe("HVSC browse index — reporting the compact-index downgrade", () => {
  it("says it once, however many times hydration saves", async () => {
    const snapshot = hugeLibrary();
    for (let save = 0; save < 6; save += 1) {
      await saveHvscBrowseIndexSnapshot(snapshot, { foldersUnchanged: true });
    }
    expect(downgradeLogCount()).toBe(1);
  });

  it("says it again once a library has been back under the limit", async () => {
    // The first `it` already reported this downgrade, so a fresh one here is only correct because
    // the library returning under the limit is a real change of state worth knowing about.
    await saveHvscBrowseIndexSnapshot(smallLibrary());
    expect(downgradeLogCount()).toBe(0);

    await saveHvscBrowseIndexSnapshot(hugeLibrary(), { foldersUnchanged: true });
    await saveHvscBrowseIndexSnapshot(hugeLibrary(), { foldersUnchanged: true });
    expect(downgradeLogCount()).toBe(1);
  });
});
