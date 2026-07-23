/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { buildCreateDiskPlan, encodeC64uPath } from "@/lib/disks/createDisk";

describe("createDisk — buildCreateDiskPlan", () => {
  it("builds a d64 URL with default tracks and label from the stem", () => {
    const plan = buildCreateDiskPlan({ folder: "USB0", name: "games", kind: "d64" });
    expect(plan.fileName).toBe("games.d64");
    expect(plan.filePath).toBe("/USB0/games.d64");
    expect(plan.label).toBe("games");
    expect(plan.tracks).toBe(35);
    expect(plan.path).toBe("/v1/files/USB0/games.d64:create_d64?diskname=games&tracks=35");
  });

  it("appends the extension only when missing", () => {
    expect(buildCreateDiskPlan({ folder: "USB0", name: "keep.d64", kind: "d64" }).fileName).toBe("keep.d64");
    expect(buildCreateDiskPlan({ folder: "USB0", name: "KEEP.D64", kind: "d64" }).fileName).toBe("KEEP.D64");
    expect(buildCreateDiskPlan({ folder: "USB0", name: "add", kind: "d81" }).fileName).toBe("add.d81");
  });

  it("clamps the label to 16 characters and honours an explicit label", () => {
    const plan = buildCreateDiskPlan({
      folder: "USB0",
      name: "x",
      kind: "d64",
      diskLabel: "THIS LABEL IS FAR TOO LONG",
    });
    expect(plan.label).toBe("THIS LABEL IS FA");
    expect(plan.label.length).toBe(16);
  });

  it("percent-encodes label and path with %20 (not +)", () => {
    const plan = buildCreateDiskPlan({ folder: "/USB0/My Games", name: "cool disk", kind: "d81" });
    expect(plan.path).toBe("/v1/files/USB0/My%20Games/cool%20disk.d81:create_d81?diskname=cool%20disk");
    expect(plan.path).not.toContain("+");
  });

  it("does not send tracks for d71/d81", () => {
    expect(buildCreateDiskPlan({ folder: "USB0", name: "a", kind: "d71" }).path).toBe(
      "/v1/files/USB0/a.d71:create_d71?diskname=a",
    );
    expect(buildCreateDiskPlan({ folder: "USB0", name: "b", kind: "d81" }).tracks).toBeUndefined();
  });

  it("enforces d64 track bounds", () => {
    expect(buildCreateDiskPlan({ folder: "USB0", name: "a", kind: "d64", tracks: 40 }).tracks).toBe(40);
    expect(() => buildCreateDiskPlan({ folder: "USB0", name: "a", kind: "d64", tracks: 34 })).toThrow(
      "D64 tracks must be 35–41",
    );
    expect(() => buildCreateDiskPlan({ folder: "USB0", name: "a", kind: "d64", tracks: 42 })).toThrow(
      "D64 tracks must be 35–41",
    );
  });

  it("requires a valid track count for dnp", () => {
    expect(() => buildCreateDiskPlan({ folder: "USB0", name: "a", kind: "dnp" })).toThrow("DNP needs a track count");
    expect(() => buildCreateDiskPlan({ folder: "USB0", name: "a", kind: "dnp", tracks: 0 })).toThrow(
      "DNP needs a track count",
    );
    expect(() => buildCreateDiskPlan({ folder: "USB0", name: "a", kind: "dnp", tracks: 256 })).toThrow(
      "DNP needs a track count",
    );
    const plan = buildCreateDiskPlan({ folder: "USB0", name: "big", kind: "dnp", tracks: 100 });
    expect(plan.path).toBe("/v1/files/USB0/big.dnp:create_dnp?diskname=big&tracks=100");
  });

  it("rejects the virtual top-level folder", () => {
    expect(() => buildCreateDiskPlan({ folder: "/", name: "a", kind: "d64" })).toThrow("top-level / is virtual");
    expect(() => buildCreateDiskPlan({ folder: "", name: "a", kind: "d64" })).toThrow("top-level / is virtual");
    expect(() => buildCreateDiskPlan({ folder: "///", name: "a", kind: "d64" })).toThrow("top-level / is virtual");
  });

  it("rejects a name that is a path or dot entry", () => {
    for (const name of ["", "  ", "a/b", "a\\b", ".", ".."]) {
      expect(() => buildCreateDiskPlan({ folder: "USB0", name, kind: "d64" })).toThrow(
        "Enter a file name, not a path.",
      );
    }
  });

  it("normalizes surrounding slashes on the folder", () => {
    const plan = buildCreateDiskPlan({ folder: "/USB0/Sub/", name: "a", kind: "d64" });
    expect(plan.filePath).toBe("/USB0/Sub/a.d64");
  });
});

describe("createDisk — encodeC64uPath", () => {
  it("preserves separators and encodes segments", () => {
    expect(encodeC64uPath("/USB0/My Games/a b.d64")).toBe("/USB0/My%20Games/a%20b.d64");
    expect(encodeC64uPath("/Temp/#weird.d64")).toBe("/Temp/%23weird.d64");
  });
});
