/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PINNED_MANIFEST_SHA256, validateRomDependencyAssets } from "@/lib/romDependency/embeddedRomDependencyList";

const DATA = path.resolve(__dirname, "../../../src/lib/romDependency/data");

/** The list that ships in the app: HVSC #85, sidflow-data release rom-audit-hvsc85-20261030. */
const shipped = () =>
  validateRomDependencyAssets({
    bin: new Uint8Array(readFileSync(path.join(DATA, "hvsc85-sidromdep-1.bin"))),
    manifestText: readFileSync(path.join(DATA, "hvsc85-sidromdep-1.manifest.json"), "utf8"),
  });

describe("shipped SID ROM dependency list", () => {
  it("matches the pin and is the complete HVSC #85 release list", () => {
    const { list, referenceRoms } = shipped();
    expect(PINNED_MANIFEST_SHA256).toBe("712dcbd2f6aab4c1f39ad774f472b6f9c97cc73ea9b44d6d5bbe97968d77f9c0");
    expect(list.header).toMatchObject({
      hvscRelease: 85,
      incompleteSource: false,
      fileCount: 696,
      decisionCount: 1556,
      listingCeiling: 191,
      recommendedMinGrade: 128,
    });
    expect(referenceRoms.kernal).toBe("83c60d47047d7beab8e5b7bf6f67f80daa088b7a6a27de0d7e016f6484042721");
  });

  it("answers known HVSC tunes with their measured grades", () => {
    const { list } = shipped();
    // BASIC tune: no playback without ROMs, bit-exact with KERNAL+BASIC.
    expect(list.lookup("28d84c56e2f0a052b7ac587946b6f8c0", 1)).toEqual({
      listed: true,
      grades: { sidliteNone: 0, sidliteKernalBasic: 255, residfpNone: 0, residfpKernalBasic: 255 },
    });
    // Giorgio Armani, Merilyn intro (RSID): different music without ROMs, below the skip threshold.
    expect(list.lookup("4e827ff26e87160e173e7473faf120c4", 1).grades).toEqual({
      sidliteNone: 116,
      sidliteKernalBasic: 255,
      residfpNone: 115,
      residfpKernalBasic: 255,
    });
    // Mach II, Disco Trax 87 tune 2: same notes, drifting tempo; listed but above the skip threshold.
    expect(list.lookup("e606e785848c6e778eda16b1f9b35283", 1).grades.sidliteNone).toBe(159);
    // Laxity, Sanxion Loader Remix: identical register values without ROMs, so unlisted.
    expect(list.lookup("f0281b3471e0e0917b91f9dc64de1694", 1).listed).toBe(false);
  });
});
