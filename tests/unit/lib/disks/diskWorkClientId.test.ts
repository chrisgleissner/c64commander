/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISK_WORK_CLIENT_ID_STORAGE_KEY,
  getDiskWorkClientId,
  resetDiskWorkClientIdForTests,
} from "@/lib/disks/diskWorkClientId";
import { buildDiskWorkPath, isDiskWorkPath } from "@/lib/disks/diskPath";
import { addErrorLog } from "@/lib/logging";

vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));

describe("getDiskWorkClientId", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDiskWorkClientIdForTests();
    vi.mocked(addErrorLog).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an eight-digit hex id once and returns the same id on every later call", () => {
    const first = getDiskWorkClientId();

    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(getDiskWorkClientId()).toBe(first);
    expect(localStorage.getItem(DISK_WORK_CLIENT_ID_STORAGE_KEY)).toBe(first);
  });

  it("gives two installs different ids, so their work files for the same drive differ", () => {
    const first = getDiskWorkClientId();
    localStorage.clear();
    const second = getDiskWorkClientId();

    expect(second).not.toBe(first);
    expect(buildDiskWorkPath("Usb0", second, "a", "d64")).not.toBe(buildDiskWorkPath("Usb0", first, "a", "d64"));
  });

  it("replaces a stored value that is not an eight-digit hex id", () => {
    localStorage.setItem(DISK_WORK_CLIENT_ID_STORAGE_KEY, "../../x");

    const id = getDiskWorkClientId();

    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(localStorage.getItem(DISK_WORK_CLIENT_ID_STORAGE_KEY)).toBe(id);
  });

  it("keeps one id for the session and logs an error when storage refuses it", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    const first = getDiskWorkClientId();

    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(getDiskWorkClientId()).toBe(first);
    expect(addErrorLog).toHaveBeenCalledWith(
      "Disk work client id could not be stored; using one for this session only",
      expect.objectContaining({ clientId: first, error: "storage disabled" }),
    );
  });
});

describe("isDiskWorkPath", () => {
  it("recognizes this install's work file, another install's, and the shared name older builds used", () => {
    expect(isDiskWorkPath("/Usb0/c64commander-disk-work-0123abcd-a.d64")).toBe(true);
    expect(isDiskWorkPath("/USB2/c64commander-disk-work-fedc9876-b.d71")).toBe(true);
    expect(isDiskWorkPath("/USB2/c64commander-disk-work-a.d64")).toBe(true);
  });

  it("rejects names that only resemble a work file", () => {
    expect(isDiskWorkPath("/USB2/c64commander-disk-work-c.d64")).toBe(false);
    expect(isDiskWorkPath("/USB2/c64commander-disk-work-xyz-a.d64")).toBe(false);
    expect(isDiskWorkPath("/USB2/games/Frogger.d64")).toBe(false);
  });
});
