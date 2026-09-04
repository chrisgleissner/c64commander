import { describe, expect, it } from "vitest";
import { loadAll } from "js-yaml";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { FEATURE_FLAG_DEFINITIONS } from "@/lib/config/featureFlagsRegistry.generated";

/*
 * The iOS Maestro flows failed on three text anchors that production has never presented as a
 * whole element text, while the screenshots showed the app on the right page:
 *
 *   "Connection"            the Settings section header is a single <button> holding the <h2>
 *                           title and an sr-only summary, so its whole text is
 *                           "Connection Saved devices, discovery, passwords, demo mode".
 *   "Playlist"              PlaylistPanel's title is below the fold on the iOS screen and
 *                           assertVisible only counts what is on screen.
 *   "Enable HVSC downloads" no such string exists; the flag title is "HVSC downloads" and the
 *                           row is a <label>, so the checkbox's whole text also carries the
 *                           flag description.
 *
 * Maestro matches a text selector as a regex against an element's whole text, so each anchor
 * below is checked against the accessible name this repository actually builds. A rename in
 * production fails this test rather than a 25-40 minute runner cycle.
 */

const repoRoot = path.resolve(process.cwd());
const maestroRoot = path.resolve(repoRoot, ".maestro");

const readSource = (relativePath: string): string => readFileSync(path.resolve(repoRoot, relativePath), "utf8");

/** Maestro compiles a text selector as a regex and requires it to match the whole text. */
const matchesWholeText = (selector: string, text: string): boolean => new RegExp(`^(?:${selector})$`).test(text);

/** The flows the iOS workflow actually runs, read from the workflow rather than copied. */
const ciFlowNames = (): string[] => {
  const workflow = readSource(".github/workflows/ios.yaml");
  const match = /IOS_MAESTRO_FLOWS:\s*(\S+)/.exec(workflow);
  if (!match) throw new Error("ios.yaml no longer declares IOS_MAESTRO_FLOWS");
  return match[1].split(",").map((name) => name.trim());
};

/**
 * The accessible name of a `CollapsibleSection` header: the title and the summary concatenated,
 * because both live inside the one toggle <button>.
 */
const settingsSectionName = (sectionId: string): string => {
  const source = readSource("src/pages/SettingsPage.tsx");
  const anchor = source.indexOf(`id="${sectionId}"`);
  if (anchor === -1) throw new Error(`SettingsPage no longer declares a section with id="${sectionId}"`);
  const props = source.slice(anchor, anchor + 400);
  const title = /title="([^"]+)"/.exec(props);
  const summary = /summary="([^"]+)"/.exec(props);
  if (!title || !summary) throw new Error(`the ${sectionId} section no longer declares both title and summary`);
  return `${title[1]} ${summary[1]}`;
};

/**
 * The accessible name of a feature-flag row: the whole row is a <label> wrapping the flag title,
 * its description and the checkbox, so the checkbox carries both strings.
 */
const featureFlagRowName = (flagId: string): string => {
  const definition = FEATURE_FLAG_DEFINITIONS.find((candidate) => candidate.id === flagId);
  if (!definition) throw new Error(`FEATURE_FLAG_DEFINITIONS no longer defines ${flagId}`);
  return `${definition.title} ${definition.description}`;
};

const iosFlowFiles = (): string[] => {
  const files: string[] = [];
  for (const dir of [maestroRoot, path.join(maestroRoot, "subflows")]) {
    for (const entry of readdirSync(dir).sort()) {
      if (entry.startsWith("ios-") && entry.endsWith(".yaml")) files.push(path.join(dir, entry));
    }
  }
  return files;
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Every string an iOS flow matches an element by, as `visible`, `assertVisible`, or `text`. */
const collectTextSelectors = (value: JsonValue, out: string[]): void => {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTextSelectors(entry, out));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (
      (key === "visible" || key === "assertVisible" || key === "notVisible" || key === "text") &&
      typeof child === "string"
    ) {
      out.push(child);
    }
    collectTextSelectors(child as JsonValue, out);
  }
};

const selectorsIn = (filePath: string): string[] => {
  const out: string[] = [];
  collectTextSelectors(loadAll(readFileSync(filePath, "utf8")) as JsonValue, out);
  return out;
};

const CONNECTION_ANCHOR = "Connection.*";
const HVSC_FLAG_ANCHOR = "HVSC downloads.*";
const PLAY_ANCHOR = "(Your playlist|Select a playlist item to start|Playlist)";

/** Anchors that read as correct and match nothing, so a flow burns its timeout and fails later. */
const RETIRED_ANCHORS = ["Connection", "Playlist", "Enable HVSC downloads"];

describe("iOS Maestro text anchors", () => {
  it("reads the iOS flows and the CI flow list it claims to cover", () => {
    const files = iosFlowFiles();
    expect(files.length, "no iOS flow files were found, so this guard checks nothing").toBeGreaterThan(5);
    expect(
      files.some((file) => file.includes(`${path.sep}subflows${path.sep}`)),
      "no iOS subflow was read",
    ).toBe(true);
    expect(ciFlowNames()).toEqual(["ios-ci-smoke", "ios-secure-storage-persist", "ios-config-persistence"]);
    for (const name of ciFlowNames()) {
      expect(
        selectorsIn(path.join(maestroRoot, `${name}.yaml`)).length,
        `${name} matches nothing by text`,
      ).toBeGreaterThan(0);
    }
  });

  it("anchors the Settings section on the header button's whole text", () => {
    const name = settingsSectionName("connection");

    expect(name).toBe("Connection Saved devices, discovery, passwords, demo mode");
    expect(matchesWholeText(CONNECTION_ANCHOR, name)).toBe(true);
    // The negative half: the bare title is what the flows used and what failed.
    expect(matchesWholeText("Connection", name)).toBe(false);

    const settingsSubflow = readFileSync(path.join(maestroRoot, "subflows", "ios-open-settings-tab.yaml"), "utf8");
    expect(settingsSubflow).toContain(`"${CONNECTION_ANCHOR}"`);
  });

  it("anchors the HVSC flag on the label row's whole text", () => {
    const name = featureFlagRowName("hvsc_enabled");

    expect(name).toBe("HVSC downloads Show the HVSC source in Add Items.");
    expect(matchesWholeText(HVSC_FLAG_ANCHOR, name)).toBe(true);
    expect(matchesWholeText("Enable HVSC downloads", name)).toBe(false);

    const flow = readFileSync(path.join(maestroRoot, "ios-config-persistence.yaml"), "utf8");
    expect(flow).toContain(`"${HVSC_FLAG_ANCHOR}"`);
  });

  it("anchors the Play page on strings production draws above the fold", () => {
    // Each alternative is one element's whole text, and the first two are on screen with nothing
    // playing, which is the state every iOS flow reaches the Play page in.
    expect(readSource("src/pages/playFiles/components/SidRadioChip.tsx")).toContain(">Your playlist<");
    expect(readSource("src/pages/playFiles/components/PlaybackControlsCard.tsx")).toContain(
      '"Select a playlist item to start"',
    );
    expect(readSource("src/pages/playFiles/components/PlaylistPanel.tsx")).toContain('title="Playlist"');

    expect(matchesWholeText(PLAY_ANCHOR, "Your playlist")).toBe(true);
    expect(matchesWholeText(PLAY_ANCHOR, "Select a playlist item to start")).toBe(true);
    expect(matchesWholeText(PLAY_ANCHOR, "Playlist")).toBe(true);
    // The retired anchor did not match the caption the page actually shows.
    expect(matchesWholeText("Playlist", "Your playlist")).toBe(false);
  });

  it("keeps every iOS flow off the retired anchors", () => {
    const offenders: string[] = [];
    for (const file of iosFlowFiles()) {
      for (const selector of selectorsIn(file)) {
        if (RETIRED_ANCHORS.includes(selector)) {
          offenders.push(`${path.relative(maestroRoot, file)}: ${selector}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("rejects a planted retired anchor", () => {
    const planted: string[] = [];
    collectTextSelectors(
      [{ assertVisible: "Connection" }, { extendedWaitUntil: { visible: "Playlist" } }, { assertVisible: PLAY_ANCHOR }],
      planted,
    );

    expect(planted).toEqual(["Connection", "Playlist", PLAY_ANCHOR]);
    expect(planted.filter((selector) => RETIRED_ANCHORS.includes(selector))).toEqual(["Connection", "Playlist"]);
  });
});
