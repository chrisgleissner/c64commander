/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { compareFirmwareVersions, resolveMenuMapping } from "@/lib/config/menuMapping/resolveMenuMapping";

describe("resolveMenuMapping fallback chain", () => {
  it("resolves the exact C64U 1.1.0 hierarchy", () => {
    const h = resolveMenuMapping({ family: "C64U", firmwareVersion: "1.1.0" });
    expect(h?.family).toBe("C64U");
    expect(h?.firmwareVersion).toBe("1.1.0");
  });

  it("falls back to the nearest/latest C64U hierarchy for a newer firmware (3.14)", () => {
    // No 3.14 menu captured → nearest lower / latest within family = 1.1.0.
    const h = resolveMenuMapping({ family: "C64U", firmwareVersion: "3.14" });
    expect(h?.firmwareVersion).toBe("1.1.0");
  });

  it("resolves the latest within family when firmware is older than any captured menu", () => {
    const h = resolveMenuMapping({ family: "C64U", firmwareVersion: "0.9.0" });
    expect(h?.firmwareVersion).toBe("1.1.0");
  });

  it("resolves the latest within family when firmware is unknown/missing", () => {
    expect(resolveMenuMapping({ family: "C64U", firmwareVersion: null })?.firmwareVersion).toBe("1.1.0");
    expect(resolveMenuMapping({ family: "C64U" })?.firmwareVersion).toBe("1.1.0");
  });

  it("NEVER crosses families: U64 / U64E / U2 / unknown get null (no Layer B)", () => {
    expect(resolveMenuMapping({ family: "U64", firmwareVersion: "3.14" })).toBeNull();
    expect(resolveMenuMapping({ family: "U64E", firmwareVersion: "3.14e" })).toBeNull();
    expect(resolveMenuMapping({ family: "U64E2", firmwareVersion: "3.14" })).toBeNull();
    expect(resolveMenuMapping({ family: "U2", firmwareVersion: "3.11" })).toBeNull();
    expect(resolveMenuMapping({ family: "unknown" })).toBeNull();
    expect(resolveMenuMapping({ family: null })).toBeNull();
  });
});

describe("compareFirmwareVersions", () => {
  it("orders dotted numeric versions", () => {
    expect(compareFirmwareVersions("1.1.0", "1.2.0")).toBe(-1);
    expect(compareFirmwareVersions("3.14", "3.12")).toBe(1);
    expect(compareFirmwareVersions("1.1.0", "1.1.0")).toBe(0);
  });

  it("tolerates suffixes like 3.14e", () => {
    expect(compareFirmwareVersions("3.14a", "3.14e")).toBe(-1);
    expect(compareFirmwareVersions("3.14", "3.14")).toBe(0);
  });
});
