/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import {
  HVSC_LIBRARY_EXPANSION_FACTOR,
  ensureRoomForHvscInstall,
  estimateHvscInstallBytes,
  librariesToMakeRoomFor,
} from "@/lib/hvsc/hvscStorageBudget";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe("hvscStorageBudget", () => {
  describe("estimateHvscInstallBytes", () => {
    it("covers the archive plus one library", () => {
      const estimate = estimateHvscInstallBytes(100 * MB);
      expect(estimate.librariesResident).toBe(1);
      expect(estimate.requiredBytes).toBe(100 * MB + 100 * MB * HVSC_LIBRARY_EXPANSION_FACTOR);
    });

    it("stays above the footprint measured on the Pixel 4 rig", () => {
      // Measured against an installed HVSC baseline: 82,932 KB of retained
      // archive and 458,364 KB of extracted library.
      const measuredArchiveBytes = 82_932 * 1024;
      const measuredLibraryBytes = 458_364 * 1024;
      const estimate = estimateHvscInstallBytes(measuredArchiveBytes);
      expect(estimate.requiredBytes).toBeGreaterThan(measuredArchiveBytes + measuredLibraryBytes);
    });

    it("would be far too small at the archive-doubling rule the review proposed", () => {
      const measuredArchiveBytes = 82_932 * 1024;
      const measuredLibraryBytes = 458_364 * 1024;
      expect(measuredArchiveBytes * 2).toBeLessThan(measuredArchiveBytes + measuredLibraryBytes);
    });
  });

  describe("librariesToMakeRoomFor", () => {
    it("counts only the tree the extractor is about to write", () => {
      expect(librariesToMakeRoomFor()).toBe(1);
    });
  });

  describe("ensureRoomForHvscInstall", () => {
    it("rejects with the required and available sizes when the device is too full", async () => {
      const readBudget = vi.fn(async () => ({ availableBytes: 300 * MB, libraryPresent: false }));
      await expect(ensureRoomForHvscInstall({ archiveBytes: 90 * MB, readBudget })).rejects.toThrow(
        /Not enough free space.*needs about 0\.6 GB.*has 0\.3 GB free/is,
      );
    });

    it("allows an install that fits", async () => {
      const readBudget = vi.fn(async () => ({ availableBytes: 8 * GB, libraryPresent: false }));
      await expect(ensureRoomForHvscInstall({ archiveBytes: 90 * MB, readBudget })).resolves.toBeUndefined();
    });

    // The device reports FREE space, from which the installed library is already
    // excluded, so charging that library against it again refused reinstalls
    // that fit: a 90 MB archive needs 0.62 GB of free space, not 1.2 GB.
    it("allows a reinstall on the free space the new tree actually needs", async () => {
      const readBudget = vi.fn(async () => ({ availableBytes: 900 * MB, libraryPresent: true }));
      await expect(ensureRoomForHvscInstall({ archiveBytes: 90 * MB, readBudget })).resolves.toBeUndefined();
    });

    it("still refuses a reinstall that the new tree alone does not fit into", async () => {
      const readBudget = vi.fn(async () => ({ availableBytes: 400 * MB, libraryPresent: true }));
      await expect(ensureRoomForHvscInstall({ archiveBytes: 90 * MB, readBudget })).rejects.toThrow(
        /Not enough free space/i,
      );
    });

    it("does not block when the archive size is unknown", async () => {
      const readBudget = vi.fn(async () => ({ availableBytes: 1, libraryPresent: false }));
      await expect(ensureRoomForHvscInstall({ archiveBytes: null, readBudget })).resolves.toBeUndefined();
      expect(readBudget).not.toHaveBeenCalled();
    });

    it("does not block when the platform exposes no storage budget", async () => {
      const readBudget = vi.fn(async () => {
        throw new Error("not implemented");
      });
      await expect(ensureRoomForHvscInstall({ archiveBytes: 90 * MB, readBudget })).resolves.toBeUndefined();
    });

    it("does not block when the platform reports a nonsense budget", async () => {
      const readBudget = vi.fn(async () => ({ availableBytes: 0, libraryPresent: false }));
      await expect(ensureRoomForHvscInstall({ archiveBytes: 90 * MB, readBudget })).resolves.toBeUndefined();
    });
  });
});
