/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { resolvePlaybackConfig } from "@/lib/config/configResolution";

const ultimateRef = (path: string, fileName = "Demo.cfg") => ({
  kind: "ultimate" as const,
  fileName,
  path,
});

const makeCandidate = (strategy: "exact-name" | "directory" | "parent-directory", path = "/Demo.cfg") => ({
  ref: ultimateRef(path, path.split("/").pop() ?? "Demo.cfg"),
  strategy,
  distance: 0,
  confidence: "high" as const,
});

describe("resolvePlaybackConfig", () => {
  it("returns manual origin when manualConfigRef is set", () => {
    const ref = ultimateRef("/Configs/Demo.cfg");
    const result = resolvePlaybackConfig({ manualConfigRef: ref });
    expect(result.configOrigin).toBe("manual");
    expect(result.configRef).toBe(ref);
    expect(result.configOverrides).toBeNull();
  });

  it("preserves overrides when manualConfigRef is set", () => {
    const ref = ultimateRef("/Configs/Demo.cfg");
    const overrides = [{ category: "audio", item: "stereo", value: "on" as const }];
    const result = resolvePlaybackConfig({ manualConfigRef: ref, overrides });
    expect(result.configOverrides).toEqual(overrides);
  });

  it("returns manual-none origin when manualNone is true", () => {
    const result = resolvePlaybackConfig({ manualNone: true });
    expect(result.configOrigin).toBe("manual-none");
    expect(result.configRef).toBeNull();
    expect(result.configOverrides).toBeNull();
  });

  it("discards overrides when manualNone is true", () => {
    const overrides = [{ category: "audio", item: "stereo", value: "on" as const }];
    const result = resolvePlaybackConfig({ manualNone: true, overrides });
    expect(result.configOverrides).toBeNull();
  });

  it("auto-selects exact-name candidate when exactly one exists", () => {
    const candidate = makeCandidate("exact-name", "/Demo.cfg");
    const result = resolvePlaybackConfig({ candidates: [candidate] });
    expect(result.configOrigin).toBe("auto-exact");
    expect(result.configRef).toEqual(candidate.ref);
  });

  it("does not auto-select when multiple exact-name candidates exist", () => {
    const a = makeCandidate("exact-name", "/a/Demo.cfg");
    const b = makeCandidate("exact-name", "/b/Demo.cfg");
    const result = resolvePlaybackConfig({ candidates: [a, b] });
    expect(result.configOrigin).toBe("none");
    expect(result.configRef).toBeNull();
  });

  it("auto-selects directory candidate when no exact-name and one directory candidate", () => {
    const candidate = makeCandidate("directory", "/Music/Demo.cfg");
    const result = resolvePlaybackConfig({ candidates: [candidate] });
    expect(result.configOrigin).toBe("auto-directory");
    expect(result.configRef).toEqual(candidate.ref);
  });

  it("does not auto-select directory when there is also an exact-name candidate", () => {
    const exact = makeCandidate("exact-name", "/Demo.cfg");
    const dir = makeCandidate("directory", "/Music/Demo.cfg");
    const result = resolvePlaybackConfig({ candidates: [exact, dir] });
    // One exact → auto-exact wins
    expect(result.configOrigin).toBe("auto-exact");
  });

  it("returns none when no candidates at all", () => {
    const result = resolvePlaybackConfig({});
    expect(result.configOrigin).toBe("none");
    expect(result.configRef).toBeNull();
    expect(result.configCandidates).toHaveLength(0);
  });

  it("handles null candidates gracefully", () => {
    const result = resolvePlaybackConfig({ candidates: null });
    expect(result.configOrigin).toBe("none");
    expect(result.configCandidates).toHaveLength(0);
  });

  it("deduplicates candidates before resolution", () => {
    const a = makeCandidate("exact-name", "/Demo.cfg");
    const b = makeCandidate("exact-name", "/Demo.cfg"); // identical key
    const result = resolvePlaybackConfig({ candidates: [a, b] });
    // Deduped to 1 → auto-exact
    expect(result.configOrigin).toBe("auto-exact");
    expect(result.configCandidates).toHaveLength(1);
  });

  it("preserves overrides on auto-exact resolution", () => {
    const candidate = makeCandidate("exact-name", "/Demo.cfg");
    const overrides = [{ category: "audio", item: "stereo", value: "on" as const }];
    const result = resolvePlaybackConfig({ candidates: [candidate], overrides });
    expect(result.configOverrides).toEqual(overrides);
  });

  it("returns null overrides when none given and no manual ref", () => {
    const result = resolvePlaybackConfig({ candidates: [] });
    expect(result.configOverrides).toBeNull();
  });
});
