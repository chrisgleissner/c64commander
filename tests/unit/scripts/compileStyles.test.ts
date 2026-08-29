/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  StyleCompileError,
  compileStyles,
  contrastRatio,
  countPalettes,
  loadConfig,
  renderCss,
  renderTs,
  validateStyle,
} from "../../../scripts/compile-styles.mjs";

const tempDirs: string[] = [];

const createTempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "appearance-styles-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A single style, with contrast values that pass every gate in spec.md section 9. */
const validColors = () => ({
  background: "0 0% 100%",
  card: "0 0% 100%",
  "muted-surface": "0 0% 94%",
  foreground: "0 0% 10%",
  "muted-foreground": "0 0% 30%",
  primary: "228 40% 40%",
  "primary-foreground": "0 0% 100%",
  accent: "228 40% 40%",
  "accent-foreground": "0 0% 100%",
  border: "0 0% 60%",
  ring: "228 60% 30%",
  success: "150 60% 25%",
  warning: "38 90% 28%",
  destructive: "0 70% 40%",
  "destructive-foreground": "0 0% 100%",
});

const validStyleBlock = () => ({
  radius: "8px",
  edge: "hairline",
  ring_style: "solid",
  colors: validColors(),
});

const validConfig = () => ({
  schema_version: 1,
  default_style: "test-style",
  styles: {
    "test-style": {
      name: "Test Style",
      description: "A style used only in tests.",
      modes: ["light", "dark"],
      light: validStyleBlock(),
      dark: validStyleBlock(),
    },
  },
});

/**
 * The base config plus one extra key per named style, creating "second-style" as a copy of the
 * base one when it is not already declared. Keeps the renamed_from cases readable.
 */
const configWithStyles = (overrides: Record<string, Record<string, unknown>>) => {
  const config = validConfig() as unknown as { styles: Record<string, Record<string, unknown>> };
  const template = config.styles["test-style"];
  for (const [id, extra] of Object.entries(overrides)) {
    config.styles[id] = { ...(config.styles[id] ?? template), ...extra };
  }
  return config;
};

const writeYaml = (dir: string, config: unknown) => {
  const yamlPath = path.join(dir, "appearance-styles.yaml");
  writeFileSync(yamlPath, yaml.dump(config), "utf8");
  return yamlPath;
};

describe("compile-styles", () => {
  describe("contrastRatio", () => {
    it("returns 21:1 for black on white", () => {
      expect(contrastRatio("0 0% 0%", "0 0% 100%")).toBeCloseTo(21, 1);
    });

    it("returns 1:1 for identical colors", () => {
      expect(contrastRatio("228 40% 50%", "228 40% 50%")).toBeCloseTo(1, 5);
    });

    it("is symmetric", () => {
      const a = contrastRatio("0 0% 10%", "0 0% 90%");
      const b = contrastRatio("0 0% 90%", "0 0% 10%");
      expect(a).toBeCloseTo(b, 10);
    });
  });

  describe("validateStyle", () => {
    it("accepts a well-formed style", () => {
      expect(() => validateStyle("test-style", validConfig().styles["test-style"])).not.toThrow();
    });

    it("rejects a non-kebab-case id", () => {
      expect(() => validateStyle("TestStyle", validConfig().styles["test-style"])).toThrow(/kebab-case/);
    });

    it("rejects a missing colour token", () => {
      const style = validConfig().styles["test-style"];
      delete (style.light.colors as Record<string, string>).warning;
      expect(() => validateStyle("test-style", style)).toThrow(/missing required token\(s\): warning/);
    });

    it("rejects an unknown colour token", () => {
      const style = validConfig().styles["test-style"];
      (style.light.colors as Record<string, string>).popover = "0 0% 50%";
      expect(() => validateStyle("test-style", style)).toThrow(/unknown token\(s\): popover/);
    });

    it("rejects a malformed HSL triple", () => {
      const style = validConfig().styles["test-style"];
      (style.light.colors as Record<string, string>).primary = "#4A5FA8";
      expect(() => validateStyle("test-style", style)).toThrow(/must be an "H S% L%" triple/);
    });

    it("rejects ring equal to border", () => {
      const style = validConfig().styles["test-style"];
      style.light.colors.ring = style.light.colors.border;
      expect(() => validateStyle("test-style", style)).toThrow(/--ring must never equal --border/);
    });

    it("rejects an invalid edge value", () => {
      const style = validConfig().styles["test-style"];
      (style.light as { edge: string }).edge = "bevel";
      expect(() => validateStyle("test-style", style)).toThrow(/edge must be one of/);
    });

    it("rejects an invalid ring_style value", () => {
      const style = validConfig().styles["test-style"];
      (style.light as { ring_style: string }).ring_style = "sparkle";
      expect(() => validateStyle("test-style", style)).toThrow(/ring_style must be one of/);
    });

    it("rejects modes/block mismatch", () => {
      const style = validConfig().styles["test-style"];
      style.modes = ["light"];
      // dark: block is still present even though modes no longer declares it.
      expect(() => validateStyle("test-style", style)).toThrow(/disagree/);
    });

    it("rejects a contrast gate violation", () => {
      const style = validConfig().styles["test-style"];
      // foreground/card must be >= 4.5:1; two near-identical greys fail it.
      style.light.colors.foreground = "0 0% 55%";
      style.light.colors.card = "0 0% 60%";
      expect(() => validateStyle("test-style", style)).toThrow(/foreground\/card contrast/);
    });
  });

  describe("loadConfig", () => {
    it("accepts a well-formed config with no previous generated output", () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(dir, validConfig());
      const config = loadConfig({ yamlPath, tsOutputPath: path.join(dir, "does-not-exist.ts") });
      expect(Object.keys(config.styles)).toEqual(["test-style"]);
    });

    it("rejects an unknown default_style", () => {
      const dir = createTempDir();
      const raw = validConfig();
      raw.default_style = "missing";
      const yamlPath = writeYaml(dir, raw);
      expect(() => loadConfig({ yamlPath })).toThrow(/default_style .* is not one of the declared styles/);
    });

    it("rejects a style id disappearing without a retired: or renamed_from: entry", () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(dir, validConfig());
      const tsOutputPath = path.join(dir, "appStyles.ts");
      writeFileSync(tsOutputPath, 'id: "test-style",\nid: "old-style",\n', "utf8");
      expect(() => loadConfig({ yamlPath, tsOutputPath })).toThrow(/disappeared without a .* entry: old-style/);
    });

    it("treats a renamed_from: declaration as notice that the old id went away", () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(dir, configWithStyles({ "test-style": { renamed_from: ["old-style"] } }));
      const tsOutputPath = path.join(dir, "appStyles.ts");
      writeFileSync(tsOutputPath, 'id: "test-style",\nid: "old-style",\n', "utf8");
      const config = loadConfig({ yamlPath, tsOutputPath });
      expect(config.renames).toEqual({ "old-style": "test-style" });
      /*
       * And that the map reaches the file the app imports. The rename is only useful because
       * useAppStyle reads APP_STYLE_RENAMES at startup, so a map built correctly and then not
       * emitted would drop every stored old id back to the default with nothing to show for it.
       */
      expect(renderTs(config)).toContain('"old-style": "test-style"');
    });

    it("rejects a renamed_from: value that is still a live style id", () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(dir, configWithStyles({ "second-style": { renamed_from: ["test-style"] } }));
      expect(() => loadConfig({ yamlPath, tsOutputPath: path.join(dir, "a.ts") })).toThrow(
        /renamed_from lists "test-style", which is still a live style id/,
      );
    });

    it("rejects the same renamed_from: value claimed by two styles", () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(
        dir,
        configWithStyles({
          "test-style": { renamed_from: ["old-style"] },
          "second-style": { renamed_from: ["old-style"] },
        }),
      );
      expect(() => loadConfig({ yamlPath, tsOutputPath: path.join(dir, "a.ts") })).toThrow(
        /renamed_from "old-style" is claimed by both/,
      );
    });

    it("rejects a renamed_from: that is not a non-empty array of kebab-case ids", () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(dir, configWithStyles({ "test-style": { renamed_from: [] } }));
      expect(() => loadConfig({ yamlPath, tsOutputPath: path.join(dir, "a.ts") })).toThrow(
        /renamed_from must be a non-empty array/,
      );
    });

    it("allows a style id disappearing when it is listed under retired:", () => {
      const dir = createTempDir();
      const raw = validConfig();
      raw.retired = ["old-style"];
      const yamlPath = writeYaml(dir, raw);
      const tsOutputPath = path.join(dir, "appStyles.ts");
      writeFileSync(tsOutputPath, 'id: "test-style",\nid: "old-style",\n', "utf8");
      expect(() => loadConfig({ yamlPath, tsOutputPath })).not.toThrow();
    });

    it("accepts a device_scheme_map pointing at declared styles", () => {
      const dir = createTempDir();
      const raw = validConfig();
      raw.device_scheme_map = { "Ultimate Black": "test-style" };
      const yamlPath = writeYaml(dir, raw);
      expect(() => loadConfig({ yamlPath, tsOutputPath: path.join(dir, "a.ts") })).not.toThrow();
    });

    it("rejects a device_scheme_map entry pointing at an undeclared style", () => {
      const dir = createTempDir();
      const raw = validConfig();
      raw.device_scheme_map = { "Ultimate Black": "no-such-style" };
      const yamlPath = writeYaml(dir, raw);
      expect(() => loadConfig({ yamlPath, tsOutputPath: path.join(dir, "a.ts") })).toThrow(/is not a declared style/);
    });

    it("is fine with no device_scheme_map at all", () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(dir, validConfig());
      expect(() => loadConfig({ yamlPath, tsOutputPath: path.join(dir, "a.ts") })).not.toThrow();
    });
  });

  describe("renderTs / renderCss", () => {
    it("emits the expected TypeScript shape", () => {
      const config = validConfig();
      const output = renderTs(config);
      expect(output).toContain("GENERATED by scripts/compile-styles.mjs");
      expect(output).toContain('id: "test-style",');
      expect(output).toContain('export const DEFAULT_APP_STYLE_ID = "test-style";');
      expect(output).toContain("export const APP_STYLES");
      expect(output).toContain("export const DEVICE_SCHEME_TO_STYLE_ID");
    });

    it("declares AppStyleColors from the same key set the validator requires", () => {
      // The interface used to be written out by hand next to REQUIRED_COLOR_KEYS. Adding a token
      // to one and not the other left the committed appStyles.ts failing typecheck while every
      // unit test still passed, so the emitted type is derived from that list instead.
      const output = renderTs(validConfig());
      const interfaceBody = output.slice(
        output.indexOf("export interface AppStyleColors {"),
        output.indexOf("export interface AppStyleModeTokens"),
      );
      for (const key of Object.keys(validColors())) {
        const property = /^[a-z][a-zA-Z0-9]*$/.test(key) ? key : JSON.stringify(key);
        expect(interfaceBody).toContain(`readonly ${property}: string;`);
      }
      expect(interfaceBody.match(/readonly /g)).toHaveLength(Object.keys(validColors()).length);
    });

    it("emits an empty device-scheme map when none is declared", () => {
      const output = renderTs(validConfig());
      expect(output).toContain("export const DEVICE_SCHEME_TO_STYLE_ID: Readonly<Record<string, string>> = {}");
    });

    it("emits declared device-scheme entries", () => {
      const config = validConfig();
      config.device_scheme_map = { "Ultimate Black": "test-style" };
      const output = renderTs(config);
      expect(output).toContain('"Ultimate Black": "test-style"');
    });

    it("emits one CSS rule per declared mode, using html[data-app-style] selectors", () => {
      const config = validConfig();
      const output = renderCss(config);
      expect(output).toContain('html[data-app-style="test-style"] {');
      expect(output).toContain('html[data-app-style="test-style"].dark {');
      // muted-surface renames to the existing --muted custom property, not a new one.
      expect(output).toContain("--muted:");
      expect(output).not.toContain("--muted-surface:");
    });

    it("omits the appBarBand line unless a mode block declares app_bar_band", () => {
      const config = validConfig();
      expect(renderCss(config)).not.toContain("--app-bar-band");

      config.styles["test-style"].dark.app_bar_band = "linear-gradient(90deg, red, blue)";
      expect(renderCss(config)).toContain("--app-bar-band: linear-gradient(90deg, red, blue);");
    });

    it("mirrors border into --input, matching the pre-existing border===input convention", () => {
      const config = validConfig();
      const output = renderCss(config);
      const borderValue = config.styles["test-style"].light.colors.border;
      expect(output).toContain(`--border: ${borderValue};`);
      expect(output).toContain(`--input: ${borderValue};`);
    });

    it("derives the surface tokens that share a role with an authored one", () => {
      // Without these, dropdowns, selects, tooltips, progress tracks and secondary buttons keep
      // the base theme's colours under every style, because nothing else redeclares them.
      const config = validConfig();
      const output = renderCss(config);
      const { card, foreground, "muted-surface": mutedSurface } = config.styles["test-style"].light.colors;
      expect(output).toContain(`--popover: ${card};`);
      expect(output).toContain(`--card-foreground: ${foreground};`);
      expect(output).toContain(`--popover-foreground: ${foreground};`);
      expect(output).toContain(`--secondary: ${mutedSurface};`);
      expect(output).toContain(`--secondary-foreground: ${foreground};`);
    });
  });

  describe("countPalettes", () => {
    it("sums modes across all styles", () => {
      const config = validConfig();
      config.styles["dark-only"] = { ...validConfig().styles["test-style"], modes: ["dark"] };
      delete (config.styles["dark-only"] as { light?: unknown }).light;
      expect(countPalettes(config)).toBe(3);
    });
  });

  describe("compileStyles", () => {
    it("writes both generated files when they are missing", async () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(dir, validConfig());
      const tsOutputPath = path.join(dir, "out", "appStyles.ts");
      const cssOutputPath = path.join(dir, "out", "appStyles.css");

      const result = await compileStyles({ yamlPath, tsOutputPath, cssOutputPath });
      expect(result.tsChanged).toBe(true);
      expect(result.cssChanged).toBe(true);
      expect(result.paletteCount).toBe(2);
      expect(readFileSync(tsOutputPath, "utf8")).toContain('id: "test-style",');
      expect(readFileSync(cssOutputPath, "utf8")).toContain('html[data-app-style="test-style"]');
    });

    it("is idempotent: a second run with unchanged input reports no change", async () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(dir, validConfig());
      const tsOutputPath = path.join(dir, "appStyles.ts");
      const cssOutputPath = path.join(dir, "appStyles.css");

      await compileStyles({ yamlPath, tsOutputPath, cssOutputPath });
      const second = await compileStyles({ yamlPath, tsOutputPath, cssOutputPath });
      expect(second.tsChanged).toBe(false);
      expect(second.cssChanged).toBe(false);
    });

    it("--check succeeds when generated output is current", async () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(dir, validConfig());
      const tsOutputPath = path.join(dir, "appStyles.ts");
      const cssOutputPath = path.join(dir, "appStyles.css");

      await compileStyles({ yamlPath, tsOutputPath, cssOutputPath });
      const checkResult = await compileStyles({ yamlPath, tsOutputPath, cssOutputPath, check: true });
      expect(checkResult.tsChanged).toBe(false);
      expect(checkResult.cssChanged).toBe(false);
    });

    it("--check fails with the standard drift message when the .ts output is stale", async () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(dir, validConfig());
      const tsOutputPath = path.join(dir, "appStyles.ts");
      const cssOutputPath = path.join(dir, "appStyles.css");
      writeFileSync(tsOutputPath, "// stale\n", "utf8");

      await expect(compileStyles({ yamlPath, tsOutputPath, cssOutputPath, check: true })).rejects.toThrow(
        /generated file is out of date:.*\n {2}run: node scripts\/compile-styles\.mjs/,
      );
    });

    it("--check fails when the .css output is stale even if the .ts output is current", async () => {
      const dir = createTempDir();
      const yamlPath = writeYaml(dir, validConfig());
      const tsOutputPath = path.join(dir, "appStyles.ts");
      const cssOutputPath = path.join(dir, "appStyles.css");

      await compileStyles({ yamlPath, tsOutputPath, cssOutputPath });
      writeFileSync(cssOutputPath, "/* stale */\n", "utf8");

      await expect(compileStyles({ yamlPath, tsOutputPath, cssOutputPath, check: true })).rejects.toThrow(
        StyleCompileError,
      );
    });

    it("rejects a YAML source with an invalid style, wrapped in StyleCompileError", async () => {
      const dir = createTempDir();
      const raw = validConfig();
      raw.styles["test-style"].light.colors.ring = raw.styles["test-style"].light.colors.border;
      const yamlPath = writeYaml(dir, raw);

      await expect(
        compileStyles({ yamlPath, tsOutputPath: path.join(dir, "a.ts"), cssOutputPath: path.join(dir, "a.css") }),
      ).rejects.toThrow(/--ring must never equal --border/);
    });
  });
});
