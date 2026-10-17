/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { buildDriveSummaryLine, SUMMARY_SEPARATOR, summarizeMountedName } from "@/lib/drives/driveSummaryLine";

const line = (parts: string[]) => parts.join(SUMMARY_SEPARATOR);

describe("summarizeMountedName", () => {
  it.each([undefined, "", "  ", "No disk mounted"])("reports no disk for %j", (value) => {
    expect(summarizeMountedName(value)).toBe("No disk");
  });

  it("keeps only the last path segment", () => {
    expect(summarizeMountedName("/Usb0/games/Elite.d64")).toBe("Elite.d64");
    expect(summarizeMountedName("/Usb0/games/")).toBe("games");
  });

  it("keeps a name without a directory whole", () => {
    expect(summarizeMountedName("Elite.d64")).toBe("Elite.d64");
  });
});

describe("buildDriveSummaryLine", () => {
  const base = { loading: false, loadingLabel: "…" };

  it("joins short name, bus, type and disk", () => {
    expect(buildDriveSummaryLine({ ...base, name: "Drive A", busId: "8", type: "1541", mountedPath: "x.d64" })).toBe(
      line(["A", "#8", "1541", "x.d64"]),
    );
  });

  it("uses the shortest wording of the Soft IEC drive and leaves out its missing type", () => {
    expect(buildDriveSummaryLine({ ...base, name: "Soft IEC", busId: "11", mountedPath: "/Usb0/" })).toBe(
      line(["IEC", "#11", "Usb0"]),
    );
  });

  it("shows No disk for an empty drive", () => {
    expect(buildDriveSummaryLine({ ...base, name: "Drive B", busId: "9", type: "1571" })).toBe(
      line(["B", "#9", "1571", "No disk"]),
    );
  });

  it("shows the loading placeholder instead of a disk while drive data is loading", () => {
    expect(buildDriveSummaryLine({ ...base, loading: true, name: "Drive A", busId: "8", mountedPath: "x.d64" })).toBe(
      line(["A", "#8", "…"]),
    );
  });
});
