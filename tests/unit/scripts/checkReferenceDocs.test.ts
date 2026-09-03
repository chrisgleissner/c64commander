import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXCLUSIONS,
  UNDOCUMENTED_BASELINE,
  collectInteractiveTestIds,
  collectInventoryMatchers,
  collectSourceTestIds,
  expandPipeAlternatives,
  findInventoryDrift,
  findStackDrift,
  findStackLine,
  inventoryTokenToRegExp,
  isDocumented,
  isInteractiveTag,
  readInstalledMajors,
} from "../../../scripts/check-reference-docs.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const majors = readInstalledMajors(packageJson);

describe("check-reference-docs: the architecture stack line", () => {
  it("reports the two majors that were stale before this check landed", () => {
    const drift = findStackDrift("- **UI/runtime**: React 18, React Router 6, Vite 5, Capacitor 6", majors);
    expect(drift.map((entry) => entry.label)).toEqual(["Vite", "Capacitor"]);
    expect(drift[0].reason).toContain("says Vite 5");
    expect(drift[1].reason).toContain("says Capacitor 6");
  });

  it("does not confuse React with React Router, whose majors differ", () => {
    expect(majors["react"]).toBe("18");
    expect(majors["react-router-dom"]).toBe("6");
    // React Router must stay on 6: the 7 bump broke tab navigation and was reverted.
    expect(findStackDrift("- **UI/runtime**: React 18, React Router 7, Vite 6, Capacitor 8", majors)).toEqual([
      { label: "React Router", reason: "the stack line says React Router 7, package.json ships 6" },
    ]);
  });

  it("reports a version the line omits altogether", () => {
    const drift = findStackDrift("- **UI/runtime**: React 18, React Router 6, Vite 6", majors);
    expect(drift).toEqual([{ label: "Capacitor", reason: "the stack line does not state a Capacitor version" }]);
  });

  it("reports a document with no stack line at all", () => {
    expect(findStackDrift(findStackLine("# Architecture\n\nNo summary here.\n"), majors)).toEqual([
      { label: "UI/runtime", reason: "the stack line is missing from the document" },
    ]);
  });

  it("passes against the document as it stands", () => {
    expect(findStackDrift(findStackLine(readFileSync("docs/architecture.md", "utf8")), majors)).toEqual([]);
  });
});

describe("check-reference-docs: reading the inventory's abbreviations", () => {
  it("expands pipe alternatives that repeat the whole id", () => {
    expect(expandPipeAlternatives("playback-shuffle|playback-repeat")).toEqual(["playback-shuffle", "playback-repeat"]);
  });

  it("expands pipe alternatives that give the prefix once and then bare suffixes", () => {
    expect(expandPipeAlternatives("playlist-prev|play|pause|next")).toEqual([
      "playlist-prev",
      "playlist-play",
      "playlist-pause",
      "playlist-next",
    ]);
  });

  it("leaves a token with no pipe alone", () => {
    expect(expandPipeAlternatives("tab-home")).toEqual(["tab-home"]);
  });

  it("expands a brace list to its alternatives and nothing else", () => {
    const pattern = inventoryTokenToRegExp("save-ram-type-{program,basic,screen,reu}");
    expect(pattern.test("save-ram-type-basic")).toBe(true);
    expect(pattern.test("save-ram-type-cpu")).toBe(false);
  });

  it("treats a brace placeholder, an angle placeholder and a wildcard as one segment", () => {
    expect(inventoryTokenToRegExp("save-ram-custom-{start,end}-{i}").test("save-ram-custom-start-2")).toBe(true);
    expect(inventoryTokenToRegExp("sid-radio-style-<bit>").test("sid-radio-style-4")).toBe(true);
    expect(inventoryTokenToRegExp("playlist-type-*").test("playlist-type-sid")).toBe(true);
    // A segment stops at a dot, so a family wildcard cannot swallow a dotted id.
    expect(inventoryTokenToRegExp("home-tile-*").test("home-tile-action.sid-radio")).toBe(false);
  });

  it("matches the transport controls the inventory writes as one pipe token", () => {
    const matchers = collectInventoryMatchers(readFileSync("docs/cta-inventory.md", "utf8"));
    for (const id of ["playlist-prev", "playlist-play", "playlist-pause", "playlist-next"]) {
      expect(isDocumented(matchers, id), `${id} should be documented`).toBe(true);
    }
  });
});

describe("check-reference-docs: deciding what is a control", () => {
  it("accepts the component and intrinsic tags the app builds controls from", () => {
    expect(isInteractiveTag('<Button data-testid="x">')).toBe(true);
    expect(isInteractiveTag('<button data-testid="x">')).toBe(true);
    expect(isInteractiveTag('<SelectTrigger data-testid="x">')).toBe(true);
  });

  it("rejects the layout and text tags that carry most testids", () => {
    expect(isInteractiveTag('<div className="grid" data-testid="x">')).toBe(false);
    expect(isInteractiveTag('<p data-testid="x">')).toBe(false);
  });

  it("uses the ARIA role rather than the presence of a role attribute", () => {
    expect(isInteractiveTag('<div role="checkbox" data-testid="x">')).toBe(true);
    expect(isInteractiveTag('<div role="alert" data-testid="x">')).toBe(false);
    expect(isInteractiveTag('<div role="group" data-testid="x">')).toBe(false);
  });

  it("lets an explicit non-interactive role override an onClick handler", () => {
    // A live region with a dismiss handler is not a CTA a keypad user must reach.
    expect(isInteractiveTag('<div role="status" onClick={dismiss} data-testid="x">')).toBe(false);
    expect(isInteractiveTag('<div onClick={dismiss} data-testid="x">')).toBe(true);
  });

  it("does not end the tag at a > inside a JSX expression", () => {
    const source = '<div onClick={() => count > 1 && go()} role="button" data-testid="deep-row" />';
    expect(collectInteractiveTestIds(source)).toEqual(new Set(["deep-row"]));
  });

  it("finds the tag when a prop expression contains a generic or a comparison", () => {
    // `new Set<EvidenceType>(...)` puts a `<` between the tag name and the attribute, so a
    // backwards search for the nearest `<` lands on the generic and the control is skipped.
    const generic = [
      "<Button",
      '  onClick={() => onTypesChange(new Set<EvidenceType>(["Problems"]))}',
      '  data-testid="quick-filter-problems"',
      ">P</Button>",
    ].join("\n");
    expect(collectInteractiveTestIds(generic)).toEqual(new Set(["quick-filter-problems"]));

    const comparison = '<Button onClick={() => set(a < b)} data-testid="compare-row">C</Button>';
    expect(collectInteractiveTestIds(comparison)).toEqual(new Set(["compare-row"]));
  });

  it("still ignores a testid on a non-interactive tag that follows a generic", () => {
    const source = '<p title={String(new Set<Kind>())} data-testid="type-summary">n</p>';
    expect(collectInteractiveTestIds(source)).toEqual(new Set());
  });

  it("collects only the literal ids, leaving templated ones to their documented pattern", () => {
    const source = [
      '<Button data-testid="drive-reset">R</Button>',
      "<Button data-testid={`drive-reset-${bus}`}>R</Button>",
      '<p data-testid="drive-status-line">ok</p>',
    ].join("\n");
    expect(collectInteractiveTestIds(source)).toEqual(new Set(["drive-reset"]));
  });
});

describe("check-reference-docs: the inventory ratchet", () => {
  const matchers = { literals: new Set(["documented-control"]), patterns: [] };

  it("reports a control that is neither documented, excluded nor baselined", () => {
    const { undocumented } = findInventoryDrift({
      sourceIds: new Set(["documented-control", "brand-new-control"]),
      matchers,
      exclusions: new Map(),
      baseline: new Set(),
    });
    expect(undocumented).toEqual(["brand-new-control"]);
  });

  it("stays quiet for a baselined or excluded control", () => {
    const { undocumented } = findInventoryDrift({
      sourceIds: new Set(["old-gap", "not-a-control"]),
      matchers,
      exclusions: new Map([["not-a-control", "a live region"]]),
      baseline: new Set(["old-gap"]),
    });
    expect(undocumented).toEqual([]);
  });

  it("forces the baseline to shrink once a control is documented", () => {
    const { staleBaseline } = findInventoryDrift({
      sourceIds: new Set(["documented-control"]),
      matchers,
      exclusions: new Map(),
      baseline: new Set(["documented-control"]),
    });
    expect(staleBaseline).toEqual([{ id: "documented-control", reason: "now documented in the inventory" }]);
  });

  it("forces the baseline to shrink once a control is deleted", () => {
    const { staleBaseline } = findInventoryDrift({
      sourceIds: new Set(),
      matchers,
      exclusions: new Map(),
      baseline: new Set(["removed-control"]),
    });
    expect(staleBaseline).toEqual([{ id: "removed-control", reason: "no longer present in the source" }]);
  });
});

describe("check-reference-docs: the repository as it stands", () => {
  it("has an exclusion reason for every excluded id", () => {
    for (const [id, reason] of EXCLUSIONS) {
      expect(reason.length, `${id} needs a reason`).toBeGreaterThan(10);
    }
  });

  it("passes: no new undocumented control and no stale baseline entry", () => {
    const { undocumented, staleBaseline } = findInventoryDrift({
      sourceIds: collectSourceTestIds(),
      matchers: collectInventoryMatchers(readFileSync("docs/cta-inventory.md", "utf8")),
      exclusions: EXCLUSIONS,
      baseline: UNDOCUMENTED_BASELINE,
    });
    expect(undocumented, `undocumented controls: ${undocumented.join(", ")}`).toEqual([]);
    expect(
      staleBaseline.map((entry) => entry.id),
      "the baseline may only shrink",
    ).toEqual([]);
  });
});
