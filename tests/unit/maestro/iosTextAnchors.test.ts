import { describe, expect, it } from "vitest";
import { loadAll } from "js-yaml";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { FEATURE_FLAG_DEFINITIONS, FEATURE_FLAG_GROUPS } from "@/lib/config/featureFlagsRegistry.generated";
import { TAB_ROUTES } from "@/lib/navigation/tabRoutes";
import { SOURCE_LABELS } from "@/lib/sourceNavigation/sourceTerms";

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
const FEATURE_GROUP_ANCHOR = "Stable.*";

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

  it("opens the feature-group section the flag row lives in", () => {
    // `connection` is the only section SettingsPage opens by default, so the feature groups render
    // closed and their bodies are not in the tree. Scrolling alone never reaches the flag row.
    const settingsSource = readSource("src/pages/SettingsPage.tsx");
    expect(settingsSource.match(/defaultOpen/g)?.length).toBe(1);
    const connectionAnchor = settingsSource.indexOf('id="connection"');
    expect(settingsSource.indexOf("defaultOpen")).toBeGreaterThan(connectionAnchor);

    const stable = FEATURE_FLAG_GROUPS.stable;
    const experimental = FEATURE_FLAG_GROUPS.experimental;
    // The header button holds the title, a "N/M on" badge and the description, so the anchor has
    // to be a prefix match. It must not also match the experimental group's header.
    expect(matchesWholeText(FEATURE_GROUP_ANCHOR, `${stable.label} 4/4 on ${stable.description}`)).toBe(true);
    expect(matchesWholeText(FEATURE_GROUP_ANCHOR, `${experimental.label} 0/2 on ${experimental.description}`)).toBe(
      false,
    );

    // The header title is drawn by FittedText. While it hid the drawn wording behind `aria-hidden`
    // and named the span with `aria-label` alone, WebKit dropped the title from the accessibility
    // tree: on run 33842686343 this anchor matched nothing while "Stable Features 9/9 on" was on
    // screen. The wording stays readable when it is the accessible name, and is restated in a
    // visually hidden node when an abbreviation is drawn instead.
    const fitted = readSource("src/components/ui/FittedText.tsx");
    expect(fitted).toContain("aria-hidden={drawnIsAccessibleName ? undefined : true}");
    expect(fitted).toContain('<span className="sr-only">{accessibleName}</span>');

    const flow = readFileSync(path.join(maestroRoot, "ios-config-persistence.yaml"), "utf8");
    // Once before the restart and once after it.
    expect(flow.match(new RegExp(`tapOn:\\n\\s+text: "${FEATURE_GROUP_ANCHOR}"`, "g"))?.length).toBe(2);
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

/*
 * The guard above binds the three anchors that had already failed a run. Every other anchor the
 * CI flows depend on was still unbound, and each one costs a runner cycle of over an hour to
 * disprove. The block below closes that gap: it walks the `runFlow` graph of the flows
 * `ios.yaml` runs, collects the selectors that steer a run, and requires each one to be derived
 * from production here. A selector added to a CI flow without a derivation fails this test
 * rather than the run.
 *
 * A steering selector is one that changes what the run does: an assertion, a wait, a `when`
 * condition, or a tap that is not marked optional. `optional: true` is excluded because
 * `launch-and-wait` taps two dozen dismissal buttons that way and none of them has to exist.
 * A `when` is included even though it cannot fail on its own — a `when` that stops matching
 * silently skips the block it guards, which is how the demo-mode dismissal would be lost.
 */

/** Keys whose string value Maestro matches an element by. */
const SELECTOR_KEYS = new Set(["visible", "notVisible", "assertVisible", "assertNotVisible", "text"]);

/** Selectors that steer a run, per the definition above. */
const collectSteeringSelectors = (value: JsonValue, out: string[]): void => {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSteeringSelectors(entry, out));
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as { [key: string]: JsonValue };
  if (node.optional === true) return;
  for (const [key, child] of Object.entries(node)) {
    if (SELECTOR_KEYS.has(key) && typeof child === "string") out.push(child);
    collectSteeringSelectors(child, out);
  }
};

/** Every `runFlow` target of a flow, as a path relative to the flow's own directory. */
const runFlowTargets = (value: JsonValue, out: string[]): void => {
  if (Array.isArray(value)) {
    value.forEach((entry) => runFlowTargets(entry, out));
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as { [key: string]: JsonValue };
  const runFlow = node.runFlow;
  if (typeof runFlow === "string") out.push(runFlow);
  else if (runFlow && typeof runFlow === "object" && !Array.isArray(runFlow)) {
    const file = (runFlow as { [key: string]: JsonValue }).file;
    if (typeof file === "string") out.push(file);
  }
  for (const child of Object.values(node)) runFlowTargets(child, out);
};

/** The flow itself plus every flow it reaches through `runFlow`, transitively. */
const flowClosure = (entryPath: string): string[] => {
  const seen = new Set<string>();
  const pending = [path.resolve(entryPath)];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    const targets: string[] = [];
    runFlowTargets(loadAll(readFileSync(current, "utf8")) as JsonValue, targets);
    for (const target of targets) pending.push(path.resolve(path.dirname(current), target));
  }
  return [...seen].sort();
};

const steeringSelectorsOf = (entryPath: string): string[] => {
  const out: string[] = [];
  for (const file of flowClosure(entryPath)) {
    collectSteeringSelectors(loadAll(readFileSync(file, "utf8")) as JsonValue, out);
  }
  return [...new Set(out)];
};

/** The label of a primary tab, which `TabBar` renders as the button's own text. */
const tabLabel = (routePath: string): string => {
  const route = TAB_ROUTES.find((candidate) => candidate.path === routePath);
  if (!route) throw new Error(`TAB_ROUTES no longer declares a tab for ${routePath}`);
  return route.label;
};

/**
 * A translated string's fallback, which is what an untranslated CI build presents. Read from the
 * call site so a reworded fallback fails here.
 */
const translationFallback = (relativePath: string, key: string): string => {
  const match = new RegExp(`t\\("${key.replace(/\./g, "\\.")}",\\s*"([^"]+)"\\)`).exec(readSource(relativePath));
  if (!match) throw new Error(`${relativePath} no longer calls t("${key}", ...) with a literal fallback`);
  return match[1];
};

/** An `aria-label` literal, which is the accessible name WKWebView exposes for a button. */
const ariaLabel = (relativePath: string, label: string): string => {
  if (!readSource(relativePath).includes(`aria-label="${label}"`)) {
    throw new Error(`${relativePath} no longer sets aria-label="${label}"`);
  }
  return label;
};

/**
 * A string production renders as one element's whole text. Read from the source so a reworded
 * caption fails here — `>Choose source<` for a single-line element, or the string alone on its
 * own line for one JSX-formatted across lines.
 */
const elementText = (relativePath: string, text: string): string => {
  const source = readSource(relativePath);
  if (!source.includes(`>${text}<`) && !new RegExp(`^\\s*${text}\\s*$`, "m").test(source)) {
    throw new Error(`${relativePath} no longer renders "${text}" as an element's whole text`);
  }
  return text;
};

/** Each steering anchor, with the production value it has to match. */
const anchorDerivations = (): { selector: string; name: string }[] => [
  { selector: "Home", name: tabLabel("/") },
  { selector: "Settings", name: tabLabel("/settings") },
  { selector: "Play", name: tabLabel("/play") },
  { selector: CONNECTION_ANCHOR, name: settingsSectionName("connection") },
  { selector: HVSC_FLAG_ANCHOR, name: featureFlagRowName("hvsc_enabled") },
  {
    selector: "Search the app",
    name: translationFallback("src/pages/home/components/HomeSearchField.tsx", "search.openFromHome"),
  },
  { selector: "Something went wrong", name: translationFallback("src/App.tsx", "app.error.title") },
  {
    selector: "Add items to playlist",
    name: ariaLabel("src/pages/playFiles/components/PlaylistPanel.tsx", "Add items to playlist"),
  },
  {
    selector: "Add file / folder from Local",
    name: ariaLabel(
      "src/components/itemSelection/ItemSelectionDialog.tsx",
      `Add file / folder from ${SOURCE_LABELS.local}`,
    ),
  },
  { selector: "Add file / folder from C64U", name: `Add file / folder from ${SOURCE_LABELS.c64u}` },
  {
    selector: "Choose source",
    name: elementText("src/components/itemSelection/ItemSelectionDialog.tsx", "Choose source"),
  },
  {
    selector: "Continue in Demo Mode",
    name: elementText("src/components/DemoModeInterstitial.tsx", "Continue in Demo Mode"),
  },
];

describe("iOS CI flow anchors are all bound to production", () => {
  const ciFlowPaths = () => ciFlowNames().map((name) => path.join(maestroRoot, `${name}.yaml`));

  it("follows runFlow into the subflows the CI flows depend on", () => {
    const closure = flowClosure(path.join(maestroRoot, "ios-secure-storage-persist.yaml")).map((file) =>
      path.relative(maestroRoot, file),
    );

    // ios-secure-storage-persist -> ios-open-play-add-items -> launch-and-wait -> continue-demo.
    expect(closure).toContain("ios-secure-storage-persist.yaml");
    expect(closure).toContain(path.join("subflows", "ios-open-play-add-items.yaml"));
    expect(closure).toContain(path.join("subflows", "launch-and-wait.yaml"));
  });

  it("counts assertions, waits and required taps but not optional ones", () => {
    const out: string[] = [];
    collectSteeringSelectors(
      [
        { assertVisible: "Fatal" },
        { tapOn: { text: "Dismissed", optional: true } },
        { extendedWaitUntil: { visible: "Waited", timeout: 1 } },
        { extendedWaitUntil: { visible: "Skipped", optional: true } },
      ],
      out,
    );

    expect(out).toEqual(["Fatal", "Waited"]);
  });

  it("derives every steering anchor of every CI flow from production", () => {
    const derivations = anchorDerivations();
    const derived = new Map(derivations.map((entry) => [entry.selector, entry.name]));

    // Every derivation matches the production string it was read from.
    for (const { selector, name } of derivations) {
      expect(matchesWholeText(selector, name), `${selector} does not match production's "${name}"`).toBe(true);
    }
    // The alternation anchors are checked against their own production strings above.
    const checkedElsewhere = new Set([PLAY_ANCHOR, FEATURE_GROUP_ANCHOR]);

    const unbound: string[] = [];
    for (const flow of ciFlowPaths()) {
      for (const selector of steeringSelectorsOf(flow)) {
        if (!derived.has(selector) && !checkedElsewhere.has(selector)) {
          unbound.push(`${path.relative(maestroRoot, flow)}: ${selector}`);
        }
      }
    }

    expect(unbound, "a CI flow steers on an anchor no test binds to production").toEqual([]);
  });

  it("proves the C64U source anchor falls back to the static label", () => {
    // ItemSelectionDialog names the button after the source's own name, so the anchor is only
    // "C64U" while the Play page builds that source without one.
    const dialog = readSource("src/components/itemSelection/ItemSelectionDialog.tsx");
    expect(dialog).toContain(
      "aria-label={`Add file / folder from ${c64UltimateSource?.name?.trim() || SOURCE_LABELS.c64u}`}",
    );
    expect(SOURCE_LABELS.c64u).toBe("C64U");

    const playPage = readSource("src/pages/PlayFilesPage.tsx");
    expect(playPage).toContain("createUltimateSourceLocation()");
    expect(playPage).not.toContain("createUltimateSourceLocation({");
  });
});
