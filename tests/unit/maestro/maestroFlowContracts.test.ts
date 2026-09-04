import { describe, expect, it } from "vitest";
import { loadAll } from "js-yaml";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { TAB_ROUTES } from "@/lib/navigation/tabRoutes";
import path from "node:path";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const maestroRoot = path.resolve(process.cwd(), ".maestro");

const readYaml = (filePath: string): JsonValue => loadAll(readFileSync(filePath, "utf8")) as JsonValue;

const listYamlFiles = (dirPath: string): string[] => {
  const entries = readdirSync(dirPath).sort();
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...listYamlFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
      results.push(fullPath);
    }
  }
  return results;
};

const collectScrollUntilVisibleErrors = (
  value: JsonValue,
  filePath: string,
  errors: string[],
  trail: string[] = [],
) => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectScrollUntilVisibleErrors(entry, filePath, errors, [...trail, `[${index}]`]));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextTrail = [...trail, key];
    if (key === "scrollUntilVisible") {
      if (!child || typeof child !== "object" || Array.isArray(child)) {
        errors.push(`${filePath}: ${nextTrail.join(".")} must be a mapping with explicit options`);
      } else {
        const config = child as Record<string, unknown>;
        const element = config.element;
        const hasValidElement =
          typeof element === "string" || (!!element && typeof element === "object" && !Array.isArray(element));
        if (!hasValidElement) {
          errors.push(`${filePath}: ${nextTrail.join(".")} must define an unambiguous element selector`);
        }
        if (typeof config.direction !== "string") {
          errors.push(`${filePath}: ${nextTrail.join(".")} must define direction`);
        }
        if (config.timeout === undefined || config.timeout === null) {
          errors.push(`${filePath}: ${nextTrail.join(".")} must define timeout`);
        }
      }
    }

    collectScrollUntilVisibleErrors(child as JsonValue, filePath, errors, nextTrail);
  }
};

const collectRetryCommandErrors = (value: JsonValue, filePath: string, errors: string[], trail: string[] = []) => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectRetryCommandErrors(entry, filePath, errors, [...trail, `[${index}]`]));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextTrail = [...trail, key];
    if (key === "retry") {
      if (!child || typeof child !== "object" || Array.isArray(child)) {
        errors.push(`${filePath}: ${nextTrail.join(".")} must be a mapping with maxRetries and commands`);
      } else {
        const retryConfig = child as Record<string, JsonValue>;
        if (typeof retryConfig.maxRetries !== "number") {
          errors.push(`${filePath}: ${nextTrail.join(".")}.maxRetries must be a number`);
        }

        const commands = retryConfig.commands;
        if (!Array.isArray(commands) || commands.length === 0) {
          errors.push(`${filePath}: ${nextTrail.join(".")}.commands must be a non-empty command list`);
        } else {
          commands.forEach((command, index) => {
            if (typeof command === "string") {
              return;
            }
            if (!command || typeof command !== "object" || Array.isArray(command)) {
              errors.push(
                `${filePath}: ${nextTrail.join(".")}.commands[${index}] must be a Maestro command mapping or scalar command`,
              );
              return;
            }

            const keys = Object.keys(command);
            if (keys.length !== 1) {
              errors.push(
                `${filePath}: ${nextTrail.join(".")}.commands[${index}] must contain exactly one command key; found ${keys.join(", ")}`,
              );
            }
          });
        }
      }
    }

    collectRetryCommandErrors(child as JsonValue, filePath, errors, nextTrail);
  }
};

const findScrollUntilVisibleStep = (
  steps: JsonValue,
  selector: { id?: string; text?: string },
): JsonValue | undefined => {
  if (!Array.isArray(steps)) {
    return undefined;
  }

  return steps.find((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      return false;
    }

    const scrollUntilVisible = (step as Record<string, JsonValue>).scrollUntilVisible;
    if (!scrollUntilVisible || typeof scrollUntilVisible !== "object" || Array.isArray(scrollUntilVisible)) {
      return false;
    }

    const element = (scrollUntilVisible as Record<string, JsonValue>).element;
    if (!element || typeof element !== "object" || Array.isArray(element)) {
      return false;
    }

    const elementSelector = element as Record<string, JsonValue>;
    return Object.entries(selector).every(([key, value]) => elementSelector[key] === value);
  });
};

const androidFlowFiles = (): string[] =>
  listYamlFiles(maestroRoot)
    .map((filePath) => path.relative(process.cwd(), filePath))
    .filter((filePath) => !path.basename(filePath).startsWith("ios-"));

// A retry block holds its own command list, and both guards below reason about the order
// commands run in, so the block is replaced by the commands it wraps rather than skipped.
const flattenCommands = (value: JsonValue, out: JsonValue[] = []): JsonValue[] => {
  if (Array.isArray(value)) {
    value.forEach((entry) => flattenCommands(entry, out));
    return out;
  }
  if (!value || typeof value !== "object") {
    return out;
  }
  const retry = (value as Record<string, JsonValue>).retry;
  if (retry && typeof retry === "object" && !Array.isArray(retry)) {
    flattenCommands((retry as Record<string, JsonValue>).commands ?? null, out);
    return out;
  }
  out.push(value);
  return out;
};

const commandOption = (command: JsonValue, key: string): Record<string, JsonValue> | null => {
  if (!command || typeof command !== "object" || Array.isArray(command)) return null;
  const option = (command as Record<string, JsonValue>)[key];
  if (!option || typeof option !== "object" || Array.isArray(option)) return null;
  return option as Record<string, JsonValue>;
};

const tappedTabName = (command: JsonValue): string | null => {
  const tapOn = commandOption(command, "tapOn");
  const id = tapOn?.id;
  return typeof id === "string" && id.startsWith("tab-") ? id.slice("tab-".length) : null;
};

const assertedPageName = (command: JsonValue): string | null => {
  const assertVisible = commandOption(command, "assertVisible");
  const id = assertVisible?.id;
  return typeof id === "string" && id.startsWith("page-") ? id.slice("page-".length) : null;
};

const TAB_BAR_COORDINATE = /^\s*\d+(?:\.\d+)?%\s*,\s*(\d+(?:\.\d+)?)%\s*$/;

const collectTabBarCoordinateTaps = (commands: JsonValue[], filePath: string): string[] => {
  const errors: string[] = [];
  commands.forEach((command, index) => {
    const point = commandOption(command, "tapOn")?.point;
    if (typeof point !== "string") return;
    const match = TAB_BAR_COORDINATE.exec(point);
    if (!match) return;
    if (Number(match[1]) < 90) return;
    errors.push(`${filePath}: [${index}] taps the tab bar at "${point}" instead of a tab id`);
  });
  return errors;
};

const collectUnprovedTabTaps = (commands: JsonValue[], filePath: string): string[] => {
  const errors: string[] = [];
  let pendingTab: { name: string; index: number } | null = null;

  const reportPending = () => {
    if (!pendingTab) return;
    errors.push(
      `${filePath}: [${pendingTab.index}] tapped tab-${pendingTab.name} without asserting page-${pendingTab.name}`,
    );
    pendingTab = null;
  };

  commands.forEach((command, index) => {
    const pageName = assertedPageName(command);
    if (pageName && pendingTab?.name === pageName) {
      pendingTab = null;
      return;
    }
    const tabName = tappedTabName(command);
    if (!tabName) return;
    reportPending();
    pendingTab = { name: tabName, index };
  });

  reportPending();
  return errors;
};

describe("Maestro flow contracts", () => {
  // The guard below asserts that a collected error list is empty, so it passes having
  // read nothing if `.maestro` moves or `listYamlFiles` stops matching. These two check
  // that the walk still finds the flows and that both collectors still reject a bad flow.
  it("walks the Maestro flow tree it claims to cover", () => {
    expect(existsSync(maestroRoot), ".maestro is not a directory, so this guard parses nothing").toBe(true);
    const files = listYamlFiles(maestroRoot);
    expect(files.length, "the Maestro flow walk found no YAML file").toBeGreaterThan(40);
    expect(
      files.some((filePath) => path.relative(maestroRoot, filePath).includes(path.sep)),
      "the walk did not descend into .maestro subdirectories",
    ).toBe(true);
  });

  it("rejects a planted scrollUntilVisible and retry violation", () => {
    const errors: string[] = [];
    collectScrollUntilVisibleErrors(
      [{ scrollUntilVisible: { element: { id: "tab-home" } } }],
      ".maestro/planted.yaml",
      errors,
    );
    collectRetryCommandErrors(
      [{ retry: { maxRetries: "three", commands: [{ tapOn: { id: "a" }, assertVisible: "b" }] } }],
      ".maestro/planted.yaml",
      errors,
    );

    expect(errors).toEqual([
      ".maestro/planted.yaml: [0].scrollUntilVisible must define direction",
      ".maestro/planted.yaml: [0].scrollUntilVisible must define timeout",
      ".maestro/planted.yaml: [0].retry.maxRetries must be a number",
      ".maestro/planted.yaml: [0].retry.commands[0] must contain exactly one command key; found tapOn, assertVisible",
    ]);
  });

  it("parses every Maestro YAML file and hardens scrollUntilVisible and retry usage", () => {
    const files = listYamlFiles(maestroRoot);
    const errors: string[] = [];

    for (const filePath of files) {
      const parsed = readYaml(filePath);
      collectScrollUntilVisibleErrors(parsed, path.relative(process.cwd(), filePath), errors);
      collectRetryCommandErrors(parsed, path.relative(process.cwd(), filePath), errors);
    }

    expect(errors).toEqual([]);
  });

  it("keeps ci-critical-ios limited to the reduced retained suite", () => {
    const iosFlowFiles = listYamlFiles(maestroRoot)
      .map((filePath) => path.relative(process.cwd(), filePath))
      .filter((filePath) => filePath.startsWith(".maestro/ios-") && filePath.endsWith(".yaml"));

    const taggedFlows = iosFlowFiles
      .filter((filePath) => readFileSync(path.resolve(process.cwd(), filePath), "utf8").includes("ci-critical-ios"))
      .sort();

    expect(taggedFlows).toEqual([
      ".maestro/ios-ci-smoke.yaml",
      ".maestro/ios-config-persistence.yaml",
      ".maestro/ios-secure-storage-persist.yaml",
    ]);
  });

  it("defines the consolidated iOS CI smoke flow without common-navigation overhead", () => {
    const rawSource = readFileSync(path.resolve(process.cwd(), ".maestro/ios-ci-smoke.yaml"), "utf8");
    expect(rawSource).toContain("runFlow: subflows/launch-and-wait.yaml");
    expect(rawSource).toContain('assertVisible: "Connection"');
    expect(rawSource).toContain('assertVisible: "Add file / folder from Local"');
    expect(rawSource).toContain('assertVisible: "Add file / folder from C64U"');
    expect(rawSource).not.toContain("common-navigation");
    expect(readYaml(path.resolve(process.cwd(), ".maestro/ios-ci-smoke.yaml"))).toBeTruthy();
  });

  it("keeps Android HVSC smoke flows anchored through stable features, playlist, and HVSC section", () => {
    const smokeHvsc = readFileSync(path.resolve(process.cwd(), ".maestro/smoke-hvsc.yaml"), "utf8");
    const smokeHvscLowRam = readFileSync(path.resolve(process.cwd(), ".maestro/smoke-hvsc-lowram.yaml"), "utf8");
    const edgeConfigPersistence = readFileSync(
      path.resolve(process.cwd(), ".maestro/edge-config-persistence.yaml"),
      "utf8",
    );
    const smokeHvscParsed = readYaml(path.resolve(process.cwd(), ".maestro/smoke-hvsc.yaml")) as JsonValue[];
    const smokeHvscLowRamParsed = readYaml(
      path.resolve(process.cwd(), ".maestro/smoke-hvsc-lowram.yaml"),
    ) as JsonValue[];
    const edgeConfigPersistenceParsed = readYaml(
      path.resolve(process.cwd(), ".maestro/edge-config-persistence.yaml"),
    ) as JsonValue[];
    const smokeHvscSteps = smokeHvscParsed[1];
    const smokeHvscLowRamSteps = smokeHvscLowRamParsed[1];
    const edgeConfigPersistenceSteps = edgeConfigPersistenceParsed[1];
    const smokeHvscPlaylistScrollStep = findScrollUntilVisibleStep(smokeHvscSteps, { id: "hvsc-download" });
    const smokeHvscLowRamPlaylistScrollStep = findScrollUntilVisibleStep(smokeHvscLowRamSteps, { id: "hvsc-download" });
    for (const rawSource of [smokeHvsc, smokeHvscLowRam]) {
      expect(rawSource).toContain("start: 50%, 78%");
      expect(rawSource).toContain("end: 50%, 28%");
      expect(rawSource).toContain("duration: 400");
      expect(rawSource).toContain("id: feature-flag-hvsc_enabled");
      expect(rawSource).not.toContain('text: "Stable Features"');
      expect(rawSource).not.toContain("retry:");
    }

    for (const rawSource of [smokeHvsc, smokeHvscLowRam, edgeConfigPersistence]) {
      expect(rawSource).not.toContain('point: "75%,95%"');
    }

    for (const rawSource of [smokeHvsc, smokeHvscLowRam]) {
      expect(rawSource).toContain('id: "tab-settings"');
      expect(rawSource).toContain('id: "tab-play"');
      expect(rawSource).not.toContain('point: "25%,95%"');
    }

    for (const rawSource of [smokeHvsc, smokeHvscLowRam]) {
      expect(rawSource).toContain("id: feature-flag-hvsc_enabled");
      expect(rawSource).toContain("checked: false");
      expect(rawSource).toContain('visible: "Play files"');
      expect(rawSource).toContain("id: hvsc-download");
      expect(rawSource).toContain("timeout: ${LONG_TIMEOUT}");
    }

    expect(Array.isArray(smokeHvscSteps)).toBe(true);
    expect(Array.isArray(smokeHvscLowRamSteps)).toBe(true);
    expect(Array.isArray(edgeConfigPersistenceSteps)).toBe(true);
    expect(smokeHvscPlaylistScrollStep).toEqual({
      scrollUntilVisible: {
        element: { id: "hvsc-download" },
        direction: "DOWN",
        speed: 80,
        timeout: "${LONG_TIMEOUT}",
        visibilityPercentage: 50,
        centerElement: true,
      },
    });
    expect(edgeConfigPersistence).toContain("start: 50%, 78%");
    expect(edgeConfigPersistence).toContain("end: 50%, 28%");
    expect(edgeConfigPersistence).toContain("id: feature-flag-hvsc_enabled");
    expect(edgeConfigPersistence).not.toContain("retry:");
    expect(smokeHvscLowRamPlaylistScrollStep).toEqual({
      scrollUntilVisible: {
        element: { id: "hvsc-download" },
        direction: "DOWN",
        speed: 80,
        timeout: "${LONG_TIMEOUT}",
        visibilityPercentage: 50,
        centerElement: true,
      },
    });
    expect((smokeHvsc.match(/checked: false/g) ?? []).length).toBe(3);
    expect((smokeHvscLowRam.match(/checked: false/g) ?? []).length).toBe(3);
    expect((edgeConfigPersistence.match(/checked: false/g) ?? []).length).toBe(3);
    expect((smokeHvsc.match(/id: feature-flag-hvsc_enabled/g) ?? []).length).toBe(3);
    expect((smokeHvscLowRam.match(/id: feature-flag-hvsc_enabled/g) ?? []).length).toBe(3);
    expect((edgeConfigPersistence.match(/id: feature-flag-hvsc_enabled/g) ?? []).length).toBe(3);

    expect(smokeHvsc).toContain("id: hvsc-ingest");
    expect(smokeHvscLowRam).toContain("id: hvsc-download");
    expect(edgeConfigPersistence).toContain("id: hvsc-download");
  });

  it("primes Android HVSC flows below the playback sliders before searching for hvsc-download", () => {
    const smokeHvsc = readFileSync(path.resolve(process.cwd(), ".maestro/smoke-hvsc.yaml"), "utf8");
    const smokeHvscLowRam = readFileSync(path.resolve(process.cwd(), ".maestro/smoke-hvsc-lowram.yaml"), "utf8");
    const edgeConfigPersistence = readFileSync(
      path.resolve(process.cwd(), ".maestro/edge-config-persistence.yaml"),
      "utf8",
    );

    for (const rawSource of [smokeHvsc, smokeHvscLowRam, edgeConfigPersistence]) {
      expect(rawSource).toContain('id: "tab-play"');
      expect(rawSource).toContain("start: 50%, 86%");
      expect(rawSource).toContain("end: 50%, 38%");
      expect(rawSource).toContain("speed: 80");
    }
  });

  it("keeps Android common navigation on tab ids instead of gesture-edge coordinates", () => {
    const commonNavigation = readFileSync(
      path.resolve(process.cwd(), ".maestro/subflows/common-navigation.yaml"),
      "utf8",
    );

    expect(commonNavigation).toContain('id: "tab-play"');
    expect(commonNavigation).toContain('id: "tab-settings"');
    expect(commonNavigation).toContain('id: "tab-config"');
    expect(commonNavigation).toContain('id: "tab-home"');
    expect(commonNavigation).not.toContain('point: "25%,95%"');
  });

  // The startup device discovery dialog is modal and re-arms itself while a background
  // scan keeps finding nothing, so it can cover the tab bar again between one tab and the
  // next - after Home has rendered and after the dismissals in launch-and-wait have run.
  // Each tab tap therefore has to sit in a retry that dismisses the dialog first, so a
  // late dialog is cleared and the tap retried instead of failing the walk.
  it("retries every tab tap behind a device discovery dismissal", () => {
    const flow = readYaml(path.resolve(process.cwd(), ".maestro/subflows/common-navigation.yaml"));
    const steps = Array.isArray(flow) ? (flow.flat() as JsonValue[]) : [];

    const tabIds = ["tab-play", "tab-settings", "tab-config", "tab-home"];
    const guarded = new Set<string>();

    for (const step of steps) {
      if (!step || typeof step !== "object" || Array.isArray(step)) continue;
      const retry = (step as Record<string, JsonValue>).retry;
      if (!retry || typeof retry !== "object" || Array.isArray(retry)) continue;
      const commands = (retry as Record<string, JsonValue>).commands;
      if (!Array.isArray(commands)) continue;

      const tapTargets = commands.map((command) => {
        if (!command || typeof command !== "object" || Array.isArray(command)) return null;
        const tapOn = (command as Record<string, JsonValue>).tapOn;
        if (!tapOn || typeof tapOn !== "object" || Array.isArray(tapOn)) return null;
        return tapOn as Record<string, JsonValue>;
      });

      const dismissalIndex = tapTargets.findIndex((target) => target?.text === "Not now" && target?.optional === true);
      if (dismissalIndex < 0) continue;

      tapTargets.forEach((target, index) => {
        if (index <= dismissalIndex) return;
        if (typeof target?.id === "string" && tabIds.includes(target.id)) guarded.add(target.id);
      });
    }

    expect([...guarded].sort()).toEqual([...tabIds].sort());
  });

  // The tab-bar labels render outside the page and are present whichever tab is selected,
  // so `assertVisible: "Settings"` passes on a tab tap that did nothing and on a page that
  // never rendered - which is how a crashed page and an un-renamed device shipped in 0.9.6.
  // SwipeNavigationLayer puts a `page-<tab>` id on the active slot alone, and Maestro
  // matches `id:` against the HTML id attribute, so that id is the discriminating anchor.
  it("proves each tab tap landed with the active slot id, not the tab-bar label", () => {
    const flow = readYaml(path.resolve(process.cwd(), ".maestro/subflows/common-navigation.yaml"));
    const steps = Array.isArray(flow) ? (flow.flat() as JsonValue[]) : [];

    const assertedPageId = (command: JsonValue): string | null => {
      if (!command || typeof command !== "object" || Array.isArray(command)) return null;
      const assertVisible = (command as Record<string, JsonValue>).assertVisible;
      if (!assertVisible || typeof assertVisible !== "object" || Array.isArray(assertVisible)) return null;
      const id = (assertVisible as Record<string, JsonValue>).id;
      return typeof id === "string" && id.startsWith("page-") ? id : null;
    };

    const proved = new Set<string>();
    for (const step of steps) {
      if (!step || typeof step !== "object" || Array.isArray(step)) continue;
      const retry = (step as Record<string, JsonValue>).retry;
      if (!retry || typeof retry !== "object" || Array.isArray(retry)) continue;
      const commands = (retry as Record<string, JsonValue>).commands;
      if (!Array.isArray(commands)) continue;

      const tapIndex = commands.findIndex((command) => {
        if (!command || typeof command !== "object" || Array.isArray(command)) return false;
        const tapOn = (command as Record<string, JsonValue>).tapOn;
        if (!tapOn || typeof tapOn !== "object" || Array.isArray(tapOn)) return false;
        const id = (tapOn as Record<string, JsonValue>).id;
        return typeof id === "string" && id.startsWith("tab-");
      });

      // The first block taps no tab: it dismisses the startup dialogs and waits for the
      // app to come up, so its page id is the one the app boots into.
      const searchFrom = tapIndex < 0 ? 0 : tapIndex + 1;
      for (let index = searchFrom; index < commands.length; index += 1) {
        const pageId = assertedPageId(commands[index] as JsonValue);
        if (pageId) proved.add(pageId);
      }
    }

    // Derived from the production route table, so a renamed tab cannot leave this passing
    // against a stale copy of the labels.
    const pageIdFor = (label: string) => `page-${label.toLowerCase()}`;
    expect([...proved].sort()).toEqual(
      [pageIdFor("Home"), pageIdFor("Play"), pageIdFor("Settings"), pageIdFor("Config")]
        .filter((id) => TAB_ROUTES.some((route) => pageIdFor(route.label) === id))
        .sort(),
    );
  });

  // The tab bar is `overflow-x-auto` and TabBar scrolls the active tab into view, so the
  // x position of a given tab depends on the route the app is already on. A fixed
  // `point: "75%,95%"` therefore addresses whichever tab happens to sit under that column
  // at that moment, and y=95% is also inside the Android gesture-navigation edge.
  it("keeps Android tab navigation on tab ids rather than viewport coordinates", () => {
    const errors: string[] = [];
    for (const filePath of androidFlowFiles()) {
      const commands = flattenCommands(readYaml(path.resolve(process.cwd(), filePath)));
      errors.push(...collectTabBarCoordinateTaps(commands, filePath));
    }
    expect(errors).toEqual([]);
  });

  // Tab-bar labels render outside the page and are present whichever tab is selected, so
  // `assertVisible: "Settings"` passes on a tap that did nothing and on a page that never
  // rendered. SwipeNavigationLayer puts a `page-<tab>` id on the active slot alone, so that
  // id is the only selector in the DOM that distinguishes the two.
  it("proves every Android tab tap landed with the matching page id", () => {
    const errors: string[] = [];
    for (const filePath of androidFlowFiles()) {
      const commands = flattenCommands(readYaml(path.resolve(process.cwd(), filePath)));
      errors.push(...collectUnprovedTabTaps(commands, filePath));
    }
    expect(errors).toEqual([]);
  });

  it("rejects a planted coordinate tab tap and an unproved tab tap", () => {
    expect(
      collectTabBarCoordinateTaps(
        flattenCommands([{ tapOn: { point: "75%,95%" } }, { tapOn: { point: "50%,40%" } }]),
        ".maestro/planted.yaml",
      ),
    ).toEqual(['.maestro/planted.yaml: [0] taps the tab bar at "75%,95%" instead of a tab id']);

    expect(
      collectUnprovedTabTaps(
        flattenCommands([
          { retry: { maxRetries: 3, commands: [{ tapOn: { id: "tab-play" } }, { assertVisible: "Play files" }] } },
          { tapOn: { id: "tab-home" } },
          { assertVisible: { id: "page-home" } },
        ]),
        ".maestro/planted.yaml",
      ),
    ).toEqual([".maestro/planted.yaml: [0] tapped tab-play without asserting page-play"]);
  });

  // The page ids the guards above accept have to be the ones SwipeNavigationLayer emits,
  // so a renamed tab cannot leave a stale flow passing.
  it("derives the accepted page ids from the production route table", () => {
    const pageIds = new Set<string>();
    for (const filePath of androidFlowFiles()) {
      for (const command of flattenCommands(readYaml(path.resolve(process.cwd(), filePath)))) {
        const pageName = assertedPageName(command);
        if (pageName) pageIds.add(pageName);
      }
    }
    expect(pageIds.size).toBeGreaterThan(0);
    for (const pageName of pageIds) {
      expect(
        TAB_ROUTES.some((route) => route.label.toLowerCase() === pageName),
        `page-${pageName} is not a tab in TAB_ROUTES`,
      ).toBe(true);
    }
  });

  it("keeps local binary playback picker navigation independent of DocumentsUI toolbar ids", () => {
    const rawSource = readFileSync(path.resolve(process.cwd(), ".maestro/local-binary-playback-proof.yaml"), "utf8");

    expect(rawSource).toContain('text: "Use this folder"');
    expect(rawSource).toContain("${FOLDER_NAME}");
    expect(rawSource).toContain('visible: "Files in C64Music"');
    expect(rawSource).toContain('visible: "Files in Download"');
    expect(rawSource).toContain('tapOn: "Download"');
    expect(rawSource).toContain("scrollUntilVisible:");
    expect(rawSource).toContain('element: "demo.d64"');
    expect(rawSource).not.toContain("com.google.android.documentsui:id/toolbar");
    expect(rawSource).not.toContain("Internal storage");
  });

  it("covers Home CPU Speed slider persistence with probe-based latency assertions on real hardware", () => {
    const rawSource = readFileSync(path.resolve(process.cwd(), ".maestro/edge-home-cpu-speed-latency.yaml"), "utf8");

    expect(rawSource).toContain("cpu-slider");
    expect(rawSource).toContain("real-network");
    expect(rawSource).toContain('text: "Close"');
    expect(rawSource).toContain('notVisible: "Diagnostics"');
    expect(rawSource).toContain('visible: "CPU Speed"');
    expect(rawSource).toContain('id: "home-cpu-speed-probe"');
    expect(rawSource).toContain("durationMs < 1000");
    expect(rawSource).toContain('id: "tab-play"');
    expect(rawSource).toContain('id: "tab-home"');
    expect(rawSource).toContain("authoritativeValue == output.firstProbe.targetValue");
    expect(rawSource).toContain("authoritativeValue == output.secondProbe.targetValue");
    expect(rawSource).toContain("C64U_HOME_CPU_SPEED_SLIDER_*");
    expect(readYaml(path.resolve(process.cwd(), ".maestro/edge-home-cpu-speed-latency.yaml"))).toBeTruthy();
  });
});
