import { describe, expect, it } from "vitest";

import { resolveWebPerfRunProfile } from "../../../scripts/hvsc/webPerfEvidence.mjs";

describe("webPerfEvidence", () => {
  it("marks real-archive scenario runs as unsupported hybrid evidence", () => {
    expect(resolveWebPerfRunProfile({ suite: "scenarios", useRealArchives: true })).toEqual(
      expect.objectContaining({
        mode: "hybrid-real-download-fixture-browse-web",
        evidenceClass: "hybrid",
        supported: false,
      }),
    );
  });

  it("marks fixture scenario runs as supported mechanism proof", () => {
    expect(resolveWebPerfRunProfile({ suite: "scenarios", useRealArchives: false })).toEqual(
      expect.objectContaining({
        mode: "fixture-s1-s11-web",
        evidenceClass: "fixture",
        supported: true,
      }),
    );
  });

  it("keeps secondary runs labeled as fixture even when real archives are requested", () => {
    expect(resolveWebPerfRunProfile({ suite: "secondary", useRealArchives: true })).toEqual(
      expect.objectContaining({
        mode: "fixture-secondary-web",
        evidenceClass: "fixture",
        supported: true,
      }),
    );
  });
});
