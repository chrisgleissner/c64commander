import { describe, expect, it } from "vitest";
import {
  ALLOWED_FILES,
  ALLOWED_PREFIXES,
  STALE_PATTERNS,
  findStaleReferences,
  isAllowed,
} from "../../../scripts/check-stale-variant-names.mjs";

describe("check-stale-variant-names", () => {
  it("guards the retired placeholder name spellings", () => {
    // "c64ucontroller" also covers "uk.gleissner.c64ucontroller".
    expect(STALE_PATTERNS).toContain("c64u-controller");
    expect(STALE_PATTERNS).toContain("C64U Controller");
    expect(STALE_PATTERNS).toContain("c64ucontroller");
  });

  it("exempts run-logs, research docs (incl. the Callback 8020 docs), and the migration regression test", () => {
    expect(isAllowed("WORKLOG.md")).toBe(true);
    expect(isAllowed("PLANS.md")).toBe(true);
    expect(isAllowed("docs/research/variants/variant-spec.md")).toBe(true);
    expect(ALLOWED_PREFIXES).toContain("docs/research/");
    // The Sailfish/Callback 8020 docs live under docs/plans/callback8020/ → covered by prefix.
    expect(isAllowed("docs/plans/callback8020/sailfish-callback-8020-android-compatibility.md")).toBe(true);
    // The Android-only variant test asserts the old variant is absent (migration guard).
    expect(ALLOWED_FILES.has("tests/unit/scripts/variantAndroidOnly.test.ts")).toBe(true);
  });

  it("does NOT exempt active source, config, or CI files", () => {
    expect(isAllowed("variants/variants.yaml")).toBe(false);
    expect(isAllowed("src/pages/HomePage.tsx")).toBe(false);
    expect(isAllowed(".github/workflows/android.yaml")).toBe(false);
  });

  it("finds no stale c64u-controller references in active tracked outputs", () => {
    const offenders = findStaleReferences();
    expect(offenders.size, `unexpected stale references: ${[...offenders.keys()].join(", ")}`).toBe(0);
  });
});
