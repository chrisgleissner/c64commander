/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));

import { readLocalSourceEntries } from "@/components/disks/readLocalSourceEntries";
import { addErrorLog } from "@/lib/logging";
import type { LocalSourceRecord } from "@/lib/sourceNavigation/localSourcesStore";

const source = (overrides: Partial<LocalSourceRecord>): LocalSourceRecord =>
  ({ id: "phone", name: "Phone", rootPath: "/", ...overrides }) as LocalSourceRecord;

describe("readLocalSourceEntries", () => {
  beforeEach(() => vi.mocked(addErrorLog).mockClear());

  it("returns the entries of a source that lists by entries", () => {
    const entries = [{ name: "a.d64", relativePath: "a.d64" }];

    expect(readLocalSourceEntries(source({ entries } as never), "test", "failed")).toEqual(entries);
  });

  it("returns null without logging for a missing source or one that lists through the Android tree", () => {
    expect(readLocalSourceEntries(undefined, "test", "failed")).toBeNull();
    expect(
      readLocalSourceEntries(source({ android: { treeUri: "content://tree" } } as never), "test", "failed"),
    ).toBeNull();
    expect(addErrorLog).not.toHaveBeenCalled();
  });

  it("logs the given message and returns null when the entries are missing", () => {
    expect(readLocalSourceEntries(source({}), "test", "Local source entries unavailable")).toBeNull();

    expect(addErrorLog).toHaveBeenCalledWith(
      "Local source entries unavailable",
      expect.objectContaining({ sourceId: "phone" }),
    );
  });
});
