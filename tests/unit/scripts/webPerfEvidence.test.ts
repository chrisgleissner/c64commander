import { describe, expect, it } from "vitest";

import { resolvePerfProfileName, resolveWebPerfRunProfile } from "../../../scripts/hvsc/webPerfEvidence.mjs";

describe("webPerfEvidence", () => {
  it("defaults to the nightly profile when real archives are requested", () => {
    expect(resolvePerfProfileName({ profile: "", useRealArchives: true })).toBe("nightly");
  });

  it("marks real-archive scenario runs as unsupported hybrid evidence", () => {
    expect(resolveWebPerfRunProfile({ suite: "scenarios", useRealArchives: true })).toEqual(
      expect.objectContaining({
        profile: "nightly",
        loops: 3,
        mode: "hybrid-real-download-fixture-browse-web",
        evidenceClass: "hybrid",
        supported: false,
      }),
    );
  });

  it("marks fixture scenario runs as supported mechanism proof", () => {
    expect(
      resolveWebPerfRunProfile({ suite: "scenarios", useRealArchives: false, profile: "manual-extended" }),
    ).toEqual(
      expect.objectContaining({
        profile: "manual-extended",
        loops: 5,
        mode: "fixture-s1-s11-web",
        evidenceClass: "fixture",
        supported: true,
      }),
    );
  });

  it("keeps secondary runs labeled as fixture even when real archives are requested", () => {
    expect(resolveWebPerfRunProfile({ suite: "secondary", useRealArchives: true })).toEqual(
      expect.objectContaining({
        profile: "nightly",
        loops: 5,
        mode: "fixture-secondary-web",
        evidenceClass: "fixture",
        supported: true,
      }),
    );
  });
});
