import { describe, expect, it } from "vitest";
import { loadAll } from "js-yaml";
import { readdirSync, readFileSync, statSync } from "node:fs";
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

const findRetryStepContaining = (steps: JsonValue, snippet: string): JsonValue | undefined => {
  if (!Array.isArray(steps)) {
    return undefined;
  }

  return steps.find((step) => JSON.stringify(step).includes(snippet));
};

describe("Maestro flow contracts", () => {
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
    const smokeHvscPlaylistScrollStep = findScrollUntilVisibleStep(smokeHvscSteps, { text: "Download HVSC" });
    const smokeHvscLowRamPlaylistScrollStep = findScrollUntilVisibleStep(smokeHvscLowRamSteps, {
      text: "Download HVSC",
    });
    const smokeHvscSettingsRetryStep = findRetryStepContaining(smokeHvscSteps, 'HVSC downloads');
    const smokeHvscLowRamSettingsRetryStep = findRetryStepContaining(smokeHvscLowRamSteps, 'HVSC downloads');
    const edgeConfigPersistenceSettingsRetryStep = findRetryStepContaining(edgeConfigPersistenceSteps, 'HVSC downloads');

    for (const rawSource of [smokeHvsc, smokeHvscLowRam]) {
      expect(rawSource).toContain('start: 50%, 78%');
      expect(rawSource).toContain('end: 50%, 28%');
      expect(rawSource).toContain('duration: 400');
      expect(rawSource).toContain('HVSC downloads');
      expect(rawSource).not.toContain('text: "Stable Features"');
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
      expect(rawSource).toContain('assertVisible: "HVSC downloads"');
      expect(rawSource).toContain('text: "HVSC downloads"');
      expect(rawSource).toContain("checked: false");
      expect(rawSource).toContain('visible: "Play Files"');
      expect(rawSource).toContain('text: "Download HVSC"');
      expect(rawSource).toContain("timeout: ${LONG_TIMEOUT}");
    }

    expect(Array.isArray(smokeHvscSteps)).toBe(true);
    expect(Array.isArray(smokeHvscLowRamSteps)).toBe(true);
    expect(Array.isArray(edgeConfigPersistenceSteps)).toBe(true);
    expect(smokeHvscPlaylistScrollStep).toEqual({
      scrollUntilVisible: {
        element: { text: "Download HVSC" },
        direction: "DOWN",
        timeout: "${LONG_TIMEOUT}",
        visibilityPercentage: 50,
        centerElement: true,
      },
    });
    expect(edgeConfigPersistence).toContain('start: 50%, 78%');
    expect(edgeConfigPersistence).toContain('end: 50%, 28%');
    expect(edgeConfigPersistence).toContain('HVSC downloads');
    expect(smokeHvscLowRamPlaylistScrollStep).toEqual({
      scrollUntilVisible: {
        element: { text: "Download HVSC" },
        direction: "DOWN",
        timeout: "${LONG_TIMEOUT}",
        visibilityPercentage: 50,
        centerElement: true,
      },
    });
    expect(smokeHvscSettingsRetryStep).toEqual({
      retry: {
        maxRetries: 6,
        commands: [
          { swipe: { start: '50%, 78%', end: '50%, 28%', duration: 400 } },
          'waitForAnimationToEnd',
          { assertVisible: 'HVSC downloads' },
          { tapOn: { text: 'HVSC downloads', checked: false, optional: true } },
          'waitForAnimationToEnd',
          { assertVisible: 'HVSC downloads' },
        ],
      },
    });
    expect(smokeHvscLowRamSettingsRetryStep).toEqual({
      retry: {
        maxRetries: 6,
        commands: [
          { swipe: { start: '50%, 78%', end: '50%, 28%', duration: 400 } },
          'waitForAnimationToEnd',
          { assertVisible: 'HVSC downloads' },
          { tapOn: { text: 'HVSC downloads', checked: false, optional: true } },
          'waitForAnimationToEnd',
          { assertVisible: 'HVSC downloads' },
        ],
      },
    });
    expect(edgeConfigPersistenceSettingsRetryStep).toEqual({
      retry: {
        maxRetries: 6,
        commands: [
          { swipe: { start: '50%, 78%', end: '50%, 28%', duration: 400 } },
          'waitForAnimationToEnd',
          { assertVisible: 'HVSC downloads' },
          { tapOn: { text: 'HVSC downloads', checked: false, optional: true } },
          'waitForAnimationToEnd',
          { assertVisible: 'HVSC downloads' },
        ],
      },
    });

    expect(smokeHvsc).toContain('assertVisible: "Ingest HVSC"');
    expect(smokeHvscLowRam).toContain('tapOn: "Download HVSC"');
    expect(edgeConfigPersistence).toContain('assertVisible: "Download HVSC"');
  });

  it("keeps Android common navigation on tab ids instead of gesture-edge coordinates", () => {
    const commonNavigation = readFileSync(path.resolve(process.cwd(), ".maestro/subflows/common-navigation.yaml"), "utf8");

    expect(commonNavigation).toContain('id: "tab-play"');
    expect(commonNavigation).toContain('id: "tab-settings"');
    expect(commonNavigation).toContain('id: "tab-config"');
    expect(commonNavigation).toContain('id: "tab-home"');
    expect(commonNavigation).not.toContain('point: "25%,95%"');
  });
});
