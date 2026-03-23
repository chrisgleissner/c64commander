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

  it("provides dedicated probe flows for each shared iOS subflow", () => {
    const requiredProbeTargets = new Map<string, string>([
      [".maestro/ios-subflow-open-play-tab-probe.yaml", "subflows/ios-open-play-tab.yaml"],
      [".maestro/ios-subflow-open-settings-tab-probe.yaml", "subflows/ios-open-settings-tab.yaml"],
      [".maestro/ios-subflow-open-play-add-items-probe.yaml", "subflows/ios-open-play-add-items.yaml"],
    ]);

    for (const [probePath, subflowPath] of requiredProbeTargets) {
      const rawSource = readFileSync(path.resolve(process.cwd(), probePath), "utf8");
      expect(rawSource).toContain(`runFlow: ${subflowPath}`);
      expect(readYaml(path.resolve(process.cwd(), probePath))).toBeTruthy();
    }
  });
});
