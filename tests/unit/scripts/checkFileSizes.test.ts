import { describe, expect, it } from "vitest";
import {
  GRANDFATHERED,
  GROWTH_ALLOWANCE_LINES,
  RATCHET_BAND,
  THRESHOLD,
  countLines,
  findSizeViolations,
  isGenerated,
  isTest,
  measureSources,
} from "../../../scripts/check-file-sizes.mjs";

const sizes = measureSources();

describe("check-file-sizes: what is measured", () => {
  it("uses the threshold REVIEW.md section 9 states", () => {
    expect(THRESHOLD).toBe(1000);
  });

  it("excludes generated output, which no split can shorten", () => {
    // The largest file in the repository is a generated menu mapping.
    expect(isGenerated("src/lib/config/menuMapping/c64u-1.1.0.generated.ts")).toBe(true);
    expect(isGenerated("src/generated/searchIndex.ts")).toBe(true);
    expect(isGenerated("src/lib/config/appSettings.ts")).toBe(false);
    expect(sizes.has("src/lib/config/menuMapping/c64u-1.1.0.generated.ts")).toBe(false);
  });

  it("excludes tests, which are long for a different reason", () => {
    expect(isTest("tests/unit/scripts/checkFileSizes.test.ts")).toBe(true);
    expect(isTest("src/lib/disks/diskMount.ts")).toBe(false);
  });

  it("counts lines the way an editor does", () => {
    expect(countLines("a\nb\nc")).toBe(3);
  });
});

describe("check-file-sizes: the ratchet", () => {
  const grandfathered = new Map([["big.ts", 1200]]);

  it("reports a file that newly crosses the threshold", () => {
    const { crossed } = findSizeViolations({
      sizes: new Map([
        ["fresh.ts", THRESHOLD + 1],
        ["fine.ts", THRESHOLD],
      ]),
      grandfathered,
    });
    expect(crossed).toEqual([{ file: "fresh.ts", lines: THRESHOLD + 1 }]);
  });

  it("reports a grandfathered file that grew past its ceiling and the growth allowance", () => {
    const lines = 1200 + GROWTH_ALLOWANCE_LINES + 1;
    const { grown } = findSizeViolations({ sizes: new Map([["big.ts", lines]]), grandfathered });
    expect(grown).toEqual([{ file: "big.ts", lines, ceiling: 1200 }]);
  });

  // A ceiling recorded to the exact line count leaves a bug fix in one of these files no way to
  // pass, so a small fixed allowance sits above it. The ceiling itself never rises, so this is a
  // one-off headroom rather than a per-change budget.
  it("allows a fix to push a grandfathered file a few lines past its ceiling", () => {
    const { grown } = findSizeViolations({
      sizes: new Map([["big.ts", 1200 + GROWTH_ALLOWANCE_LINES]]),
      grandfathered,
    });
    expect(grown).toEqual([]);
  });

  it("allows a grandfathered file to sit anywhere inside its band", () => {
    const { grown, staleCeilings } = findSizeViolations({ sizes: new Map([["big.ts", 1150]]), grandfathered });
    expect(grown).toEqual([]);
    expect(staleCeilings).toEqual([]);
  });

  it("demands a lower ceiling once a real split lands", () => {
    const shrunk = Math.round(1200 * (1 - RATCHET_BAND)) - 1;
    const { staleCeilings } = findSizeViolations({ sizes: new Map([["big.ts", shrunk]]), grandfathered });
    expect(staleCeilings).toEqual([
      { file: "big.ts", lines: shrunk, ceiling: 1200, reason: `has shrunk; lower its ceiling to ${shrunk}` },
    ]);
  });

  it("demands the entry be removed once the file is back under the threshold", () => {
    const { staleCeilings } = findSizeViolations({ sizes: new Map([["big.ts", 800]]), grandfathered });
    expect(staleCeilings[0].reason).toBe("is back under the threshold, so remove its entry");
  });

  it("demands the entry be removed once the file is deleted", () => {
    const { staleCeilings } = findSizeViolations({ sizes: new Map(), grandfathered });
    expect(staleCeilings[0].reason).toBe("no longer exists, so remove its entry");
  });
});

describe("check-file-sizes: the repository as it stands", () => {
  it("records every grandfathered file at a ceiling it still meets", () => {
    const { crossed, grown, staleCeilings } = findSizeViolations({ sizes, grandfathered: GRANDFATHERED });
    expect(
      crossed.map((entry) => entry.file),
      "these files crossed the threshold",
    ).toEqual([]);
    expect(
      grown.map((entry) => entry.file),
      "these files grew past their ceiling",
    ).toEqual([]);
    expect(
      staleCeilings.map((entry) => entry.file),
      "these ceilings are stale",
    ).toEqual([]);
  });

  it("fails when a real file grows past a ceiling tightened below its length and allowance", () => {
    // Exercises the production comparison against the real measured tree rather than a
    // synthetic map: dropping any single ceiling by one line must be reported.
    const [file, ceiling] = [...GRANDFATHERED][0];
    const lines = sizes.get(file);
    expect(lines, `${file} is not in the measured tree`).toBeTypeOf("number");
    const tightened = new Map(GRANDFATHERED).set(file, (lines as number) - GROWTH_ALLOWANCE_LINES - 1);
    const { grown } = findSizeViolations({ sizes, grandfathered: tightened });
    expect(grown).toEqual([{ file, lines, ceiling: (lines as number) - GROWTH_ALLOWANCE_LINES - 1 }]);
  });

  it("grandfathers only files that are genuinely over the threshold", () => {
    for (const [file, ceiling] of GRANDFATHERED) {
      expect(ceiling, `${file} does not need an entry`).toBeGreaterThan(THRESHOLD);
    }
  });
});
