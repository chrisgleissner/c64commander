import { describe, expect, it } from "vitest";

import {
  areConfigReferencesEqual,
  buildConfigReferenceKey,
  buildPlaybackConfigSignature,
  compareConfigCandidates,
  dedupeConfigCandidates,
  describeConfigOrigin,
  groupConfigOverrides,
  removeConfigOverride,
  resolvePlaybackConfigUiState,
  resolveStoredConfigOrigin,
  summarizeConfigChangeCategories,
  upsertConfigOverride,
} from "@/lib/config/playbackConfig";

const ultimateRef = (path: string, fileName = "Demo.cfg") => ({
  kind: "ultimate" as const,
  fileName,
  path,
});

const localRef = (fileName: string, opts?: { path?: string; sourceId?: string; uri?: string }) => ({
  kind: "local" as const,
  fileName,
  path: opts?.path ?? null,
  sourceId: opts?.sourceId ?? null,
  uri: opts?.uri ?? null,
});

describe("areConfigReferencesEqual", () => {
  it("returns true when both are null/undefined", () => {
    expect(areConfigReferencesEqual(null, null)).toBe(true);
    expect(areConfigReferencesEqual(undefined, undefined)).toBe(true);
    expect(areConfigReferencesEqual(null, undefined)).toBe(true);
  });

  it("returns false when one is null and the other is not", () => {
    expect(areConfigReferencesEqual(null, ultimateRef("/a.cfg"))).toBe(false);
    expect(areConfigReferencesEqual(ultimateRef("/a.cfg"), null)).toBe(false);
  });

  it("returns false when kinds differ", () => {
    expect(areConfigReferencesEqual(ultimateRef("/a.cfg", "a.cfg"), localRef("a.cfg"))).toBe(false);
  });

  it("returns false when fileNames differ", () => {
    expect(areConfigReferencesEqual(ultimateRef("/a.cfg", "a.cfg"), ultimateRef("/a.cfg", "b.cfg"))).toBe(false);
  });

  it("compares ultimate refs by normalized path", () => {
    expect(
      areConfigReferencesEqual(ultimateRef("//Configs/a.cfg", "a.cfg"), ultimateRef("/Configs/a.cfg", "a.cfg")),
    ).toBe(true);
    expect(areConfigReferencesEqual(ultimateRef("/x.cfg", "a.cfg"), ultimateRef("/y.cfg", "a.cfg"))).toBe(false);
  });

  it("compares local refs by path, sourceId, and uri", () => {
    const base = localRef("a.cfg", { path: "/local/a.cfg", sourceId: "s1", uri: "file://a" });
    expect(
      areConfigReferencesEqual(base, localRef("a.cfg", { path: "/local/a.cfg", sourceId: "s1", uri: "file://a" })),
    ).toBe(true);
    expect(
      areConfigReferencesEqual(base, localRef("a.cfg", { path: "/local/b.cfg", sourceId: "s1", uri: "file://a" })),
    ).toBe(false);
    expect(
      areConfigReferencesEqual(base, localRef("a.cfg", { path: "/local/a.cfg", sourceId: "s2", uri: "file://a" })),
    ).toBe(false);
    expect(
      areConfigReferencesEqual(base, localRef("a.cfg", { path: "/local/a.cfg", sourceId: "s1", uri: "file://b" })),
    ).toBe(false);
  });

  it("uses fileName as fallback when local path is absent", () => {
    const a = localRef("a.cfg");
    const b = localRef("a.cfg");
    expect(areConfigReferencesEqual(a, b)).toBe(true);
    expect(areConfigReferencesEqual(localRef("a.cfg"), localRef("b.cfg"))).toBe(false);
  });

  it("returns false for two different-kind refs that match fileName", () => {
    // Both 'local' but fileNames match and paths don't
    const a = localRef("a.cfg", { path: "/x/a.cfg" });
    const b = localRef("a.cfg", { path: "/y/a.cfg" });
    expect(areConfigReferencesEqual(a, b)).toBe(false);
  });
});

describe("buildConfigReferenceKey", () => {
  it("returns key for ultimate ref", () => {
    const key = buildConfigReferenceKey(ultimateRef("/Configs/Demo.cfg"));
    expect(key).toContain("ultimate:");
    expect(key).toContain("Demo.cfg");
  });

  it("returns key for local ref without sourceId/uri", () => {
    const key = buildConfigReferenceKey(localRef("Demo.cfg"));
    expect(key).toContain("local:");
  });

  it("returns key for local ref with sourceId and uri", () => {
    const key = buildConfigReferenceKey(localRef("Demo.cfg", { sourceId: "s1", uri: "file://demo" }));
    expect(key).toContain("s1");
    expect(key).toContain("file://demo");
  });
});

describe("compareConfigCandidates", () => {
  const makeCandidate = (
    strategy: "exact-name" | "directory" | "parent-directory",
    distance: number,
    path = "/a.cfg",
  ) => ({
    ref: ultimateRef(path, "a.cfg"),
    strategy,
    distance,
    confidence: "high" as const,
  });

  it("sorts by distance first", () => {
    const near = makeCandidate("parent-directory", 0);
    const far = makeCandidate("exact-name", 1);
    expect(compareConfigCandidates(near, far)).toBeLessThan(0);
    expect(compareConfigCandidates(far, near)).toBeGreaterThan(0);
  });

  it("sorts by strategy when distance is equal", () => {
    const exact = makeCandidate("exact-name", 0);
    const dir = makeCandidate("directory", 0);
    const parent = makeCandidate("parent-directory", 0);
    expect(compareConfigCandidates(exact, dir)).toBeLessThan(0);
    expect(compareConfigCandidates(dir, parent)).toBeLessThan(0);
    expect(compareConfigCandidates(parent, exact)).toBeGreaterThan(0);
  });

  it("sorts by key when distance and strategy are equal", () => {
    const a = makeCandidate("exact-name", 0, "/a.cfg");
    const b = makeCandidate("exact-name", 0, "/b.cfg");
    expect(compareConfigCandidates(a, b)).toBeLessThan(0);
    expect(compareConfigCandidates(b, a)).toBeGreaterThan(0);
  });
});

describe("dedupeConfigCandidates", () => {
  it("removes duplicate refs keeping the best-ranked one", () => {
    const a1 = {
      ref: ultimateRef("/a.cfg", "a.cfg"),
      strategy: "exact-name" as const,
      distance: 0,
      confidence: "high" as const,
    };
    const a2 = {
      ref: ultimateRef("/a.cfg", "a.cfg"),
      strategy: "directory" as const,
      distance: 1,
      confidence: "medium" as const,
    };
    const result = dedupeConfigCandidates([a2, a1]);
    expect(result).toHaveLength(1);
    expect(result[0].strategy).toBe("exact-name");
  });

  it("keeps distinct refs", () => {
    const a = {
      ref: ultimateRef("/a.cfg", "a.cfg"),
      strategy: "exact-name" as const,
      distance: 0,
      confidence: "high" as const,
    };
    const b = {
      ref: ultimateRef("/b.cfg", "b.cfg"),
      strategy: "exact-name" as const,
      distance: 0,
      confidence: "high" as const,
    };
    expect(dedupeConfigCandidates([a, b])).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(dedupeConfigCandidates([])).toHaveLength(0);
  });
});

describe("resolveStoredConfigOrigin", () => {
  it("returns provided configOrigin when truthy", () => {
    expect(resolveStoredConfigOrigin(null, "manual")).toBe("manual");
    expect(resolveStoredConfigOrigin(null, "auto-exact")).toBe("auto-exact");
  });

  it("returns manual when configRef is set but no origin", () => {
    expect(resolveStoredConfigOrigin(ultimateRef("/a.cfg"), null)).toBe("manual");
    expect(resolveStoredConfigOrigin(ultimateRef("/a.cfg"), undefined)).toBe("manual");
  });

  it("returns none when both are null", () => {
    expect(resolveStoredConfigOrigin(null, null)).toBe("none");
    expect(resolveStoredConfigOrigin(undefined, undefined)).toBe("none");
  });
});

describe("resolvePlaybackConfigUiState", () => {
  it("returns declined for manual-none origin", () => {
    expect(
      resolvePlaybackConfigUiState({
        configRef: null,
        configOrigin: "manual-none",
        configOverrides: null,
        configCandidates: null,
      }),
    ).toBe("declined");
  });

  it("returns edited when overrides are set", () => {
    expect(
      resolvePlaybackConfigUiState({
        configRef: null,
        configOrigin: "none",
        configOverrides: [{ category: "a", item: "b", value: 1 }],
        configCandidates: null,
      }),
    ).toBe("edited");
  });

  it("returns resolved when configRef is set", () => {
    expect(
      resolvePlaybackConfigUiState({
        configRef: ultimateRef("/a.cfg"),
        configOrigin: "auto-exact",
        configOverrides: null,
        configCandidates: null,
      }),
    ).toBe("resolved");
  });

  it("returns candidates when candidates list is non-empty", () => {
    const candidate = {
      ref: ultimateRef("/a.cfg", "a.cfg"),
      strategy: "exact-name" as const,
      distance: 0,
      confidence: "high" as const,
    };
    expect(
      resolvePlaybackConfigUiState({
        configRef: null,
        configOrigin: "none",
        configOverrides: null,
        configCandidates: [candidate],
      }),
    ).toBe("candidates");
  });

  it("returns none for empty state", () => {
    expect(
      resolvePlaybackConfigUiState({
        configRef: null,
        configOrigin: "none",
        configOverrides: null,
        configCandidates: null,
      }),
    ).toBe("none");
    expect(
      resolvePlaybackConfigUiState({
        configRef: null,
        configOrigin: "none",
        configOverrides: [],
        configCandidates: [],
      }),
    ).toBe("none");
  });
});

describe("describeConfigOrigin", () => {
  it("returns human-readable label for each origin", () => {
    expect(describeConfigOrigin("manual")).toBe("Manual");
    expect(describeConfigOrigin("manual-none")).toBe("No config");
    expect(describeConfigOrigin("auto-exact")).toBe("Auto: same name");
    expect(describeConfigOrigin("auto-directory")).toBe("Auto: same folder");
    expect(describeConfigOrigin("none")).toBe("Unresolved");
  });
});

describe("summarizeConfigChangeCategories", () => {
  it("returns empty array for null/undefined/empty", () => {
    expect(summarizeConfigChangeCategories(null)).toEqual([]);
    expect(summarizeConfigChangeCategories(undefined)).toEqual([]);
    expect(summarizeConfigChangeCategories([])).toEqual([]);
  });

  it("returns unique categories from overrides", () => {
    const overrides = [
      { category: "audio", item: "stereo", value: "on" },
      { category: "video", item: "border", value: 1 },
      { category: "audio", item: "volume", value: 50 },
    ];
    const result = summarizeConfigChangeCategories(overrides);
    expect(result).toHaveLength(2);
    expect(result).toContain("audio");
    expect(result).toContain("video");
  });
});

describe("upsertConfigOverride", () => {
  it("adds a new override when no match exists", () => {
    const result = upsertConfigOverride(null, { category: "audio", item: "stereo", value: "on" });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("on");
  });

  it("replaces an existing override with same category+item", () => {
    const existing = [{ category: "audio", item: "stereo", value: "on" }];
    const result = upsertConfigOverride(existing, { category: "audio", item: "stereo", value: "off" });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("off");
  });

  it("appends when category matches but item differs", () => {
    const existing = [{ category: "audio", item: "stereo", value: "on" }];
    const result = upsertConfigOverride(existing, { category: "audio", item: "volume", value: 80 });
    expect(result).toHaveLength(2);
  });

  it("appends when item matches but category differs", () => {
    const existing = [{ category: "audio", item: "stereo", value: "on" }];
    const result = upsertConfigOverride(existing, { category: "video", item: "stereo", value: "off" });
    expect(result).toHaveLength(2);
  });
});

describe("removeConfigOverride", () => {
  it("removes the matching override", () => {
    const overrides = [
      { category: "audio", item: "stereo", value: "on" },
      { category: "video", item: "border", value: 1 },
    ];
    const result = removeConfigOverride(overrides, { category: "audio", item: "stereo" });
    expect(result).toHaveLength(1);
    expect(result![0].category).toBe("video");
  });

  it("returns null when removing the last override", () => {
    const overrides = [{ category: "audio", item: "stereo", value: "on" }];
    expect(removeConfigOverride(overrides, { category: "audio", item: "stereo" })).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(removeConfigOverride(null, { category: "audio", item: "stereo" })).toBeNull();
    expect(removeConfigOverride(undefined, { category: "audio", item: "stereo" })).toBeNull();
  });

  it("keeps overrides when no match found", () => {
    const overrides = [{ category: "audio", item: "stereo", value: "on" }];
    const result = removeConfigOverride(overrides, { category: "video", item: "border" });
    expect(result).toHaveLength(1);
  });
});

describe("groupConfigOverrides", () => {
  it("returns empty object for null/undefined", () => {
    expect(groupConfigOverrides(null)).toEqual({});
    expect(groupConfigOverrides(undefined)).toEqual({});
  });

  it("groups overrides by category", () => {
    const overrides = [
      { category: "audio", item: "stereo", value: "on" },
      { category: "video", item: "border", value: 1 },
      { category: "audio", item: "volume", value: 80 },
    ];
    const result = groupConfigOverrides(overrides);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result["audio"]).toHaveLength(2);
    expect(result["video"]).toHaveLength(1);
  });
});

describe("buildPlaybackConfigSignature", () => {
  it("normalizes override order so equivalent sets share a signature", () => {
    const configRef = ultimateRef("/Configs/Demo.cfg");

    const first = buildPlaybackConfigSignature(configRef, [
      { category: "audio", item: "stereo", value: "on" },
      { category: "video", item: "border", value: 1 },
    ]);
    const second = buildPlaybackConfigSignature(configRef, [
      { category: "video", item: "border", value: 1 },
      { category: "audio", item: "stereo", value: "on" },
    ]);

    expect(first).toBe(second);
  });

  it("returns null configRef when ref is absent", () => {
    const sig = JSON.parse(buildPlaybackConfigSignature(null, null));
    expect(sig.configRef).toBeNull();
    expect(sig.overrides).toEqual([]);
  });

  it("returns null configRef when ref is undefined", () => {
    const sig = JSON.parse(buildPlaybackConfigSignature(undefined, undefined));
    expect(sig.configRef).toBeNull();
  });

  it("includes ref key and fileName when configRef is set", () => {
    const sig = JSON.parse(buildPlaybackConfigSignature(ultimateRef("/Configs/Demo.cfg"), null));
    expect(sig.configRef).not.toBeNull();
    expect(sig.configRef.fileName).toBe("Demo.cfg");
  });
});
