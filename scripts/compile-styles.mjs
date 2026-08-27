#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Compile styles/appearance-styles.yaml into src/generated/appStyles.ts and .css.
 *
 * Build-time, so the app never parses a style at runtime and every palette is gated on contrast
 * before it ships. Both outputs are committed; `--check` fails lint on drift. The contract is in
 * docs/plans/appearance-styles/spec.md sections 5, 8 and 9.
 *
 *   node scripts/compile-styles.mjs           # write both generated files
 *   node scripts/compile-styles.mjs --check    # verify they are up to date
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import prettier from "prettier";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..");
export const DEFAULT_SOURCE_PATH = join(REPO_ROOT, "styles", "appearance-styles.yaml");
export const DEFAULT_TS_OUTPUT_PATH = join(REPO_ROOT, "src", "generated", "appStyles.ts");
export const DEFAULT_CSS_OUTPUT_PATH = join(REPO_ROOT, "src", "generated", "appStyles.css");

/**
 * The per-mode colour tokens every style must declare, in the exact key spelling used by the YAML
 * source. `muted-surface` is the one name that does not match its CSS custom property 1:1 — it
 * compiles to `--muted`, the name already live in src/index.css, not a new `--muted-surface`.
 */
const REQUIRED_COLOR_KEYS = [
  "background",
  "card",
  "muted-surface",
  "foreground",
  "muted-foreground",
  "primary",
  "primary-foreground",
  "accent",
  "accent-foreground",
  "border",
  "ring",
  "success",
  "warning",
  "destructive",
  "destructive-foreground",
];

/** YAML colour key -> generated CSS custom property name. Identity except muted-surface -> muted. */
const CSS_PROPERTY_NAME = {
  "muted-surface": "muted",
};

const ALLOWED_MODES = ["light", "dark"];
const ALLOWED_EDGE = new Set(["hairline", "heavy", "gloss"]);
const ALLOWED_RING_STYLE = new Set(["solid", "inverse", "glow"]);
/** D10: only these two widths are legal, and always rendered as an inset shadow, never border-width. */
const EDGE_WIDTH_PX = { hairline: 1, gloss: 1, heavy: 2 };

const STYLE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const HSL_TRIPLE_PATTERN = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;

/** Contrast gates from spec.md section 9: [subjectKey, backgroundKey, minimumRatio, label]. */
const CONTRAST_GATES = [
  ["foreground", "card", 4.5, "foreground/card"],
  ["foreground", "background", 4.5, "foreground/background"],
  ["muted-foreground", "card", 4.5, "muted-foreground/card"],
  ["primary-foreground", "primary", 4.5, "primary-foreground/primary"],
  /*
   * --accent is a fill under --accent-foreground on shipped chrome (dropdown/select focus rows,
   * the reshuffle and ranking toggles), so it needs its own pair gate. Leaving accent-foreground
   * theme-level put near-white text on a bright accent in every dark palette, as low as 1.2:1.
   */
  ["accent-foreground", "accent", 4.5, "accent-foreground/accent"],
  ["destructive-foreground", "destructive", 4.5, "destructive-foreground/destructive"],
  ["primary", "card", 3, "primary/card"],
  ["success", "card", 4.5, "success/card"],
  ["warning", "card", 4.5, "warning/card"],
  ["destructive", "card", 4.5, "destructive/card"],
  ["ring", "card", 3, "ring/card"],
  ["ring", "muted-surface", 3, "ring/muted-surface"],
  ["border", "card", 1.5, "border/card"],
];

export class StyleCompileError extends Error {
  constructor(message) {
    super(message);
    this.name = "StyleCompileError";
  }
}

const fail = (message) => {
  throw new StyleCompileError(message);
};

/** Parses "H S% L%" into [h, s, l] with s and l normalized to 0..1. */
const parseHsl = (triple) => {
  const [h, s, l] = triple.split(/\s+/).map((part) => Number.parseFloat(part));
  return [h, s / 100, l / 100];
};

/** Standard HSL -> sRGB (0..1 channels). */
const hslToRgb = ([h, s, l]) => {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const hNorm = h / 360;
  return [hueToRgb(hNorm + 1 / 3), hueToRgb(hNorm), hueToRgb(hNorm - 1 / 3)];
};

/** WCAG relative luminance from linear-light sRGB channels (0..1 input, gamma-corrected here). */
const relativeLuminance = ([r, g, b]) => {
  const linearize = (channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const [rl, gl, bl] = [r, g, b].map(linearize);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
};

/** WCAG 2.1 contrast ratio between two "H S% L%" triples. */
export const contrastRatio = (triple1, triple2) => {
  const l1 = relativeLuminance(hslToRgb(parseHsl(triple1)));
  const l2 = relativeLuminance(hslToRgb(parseHsl(triple2)));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

const requireMapping = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a mapping`);
  }
};

const requireNonEmptyString = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
};

const validateModeBlock = (styleId, mode, block) => {
  const label = `styles.${styleId}.${mode}`;
  requireMapping(block, label);
  requireNonEmptyString(block.radius, `${label}.radius`);
  if (!ALLOWED_EDGE.has(block.edge)) {
    fail(`${label}.edge must be one of ${[...ALLOWED_EDGE].join(", ")}, got ${JSON.stringify(block.edge)}`);
  }
  if (!ALLOWED_RING_STYLE.has(block.ring_style)) {
    fail(
      `${label}.ring_style must be one of ${[...ALLOWED_RING_STYLE].join(", ")}, got ${JSON.stringify(block.ring_style)}`,
    );
  }
  if (block.app_bar_band !== undefined) {
    requireNonEmptyString(block.app_bar_band, `${label}.app_bar_band`);
  }
  requireMapping(block.colors, `${label}.colors`);

  const keys = Object.keys(block.colors).sort();
  const expected = [...REQUIRED_COLOR_KEYS].sort();
  const missing = expected.filter((key) => !keys.includes(key));
  const unknown = keys.filter((key) => !expected.includes(key));
  if (missing.length > 0) {
    fail(`${label}.colors is missing required token(s): ${missing.join(", ")}`);
  }
  if (unknown.length > 0) {
    fail(`${label}.colors declares unknown token(s): ${unknown.join(", ")}`);
  }

  for (const key of REQUIRED_COLOR_KEYS) {
    const value = block.colors[key];
    if (typeof value !== "string" || !HSL_TRIPLE_PATTERN.test(value)) {
      fail(`${label}.colors.${key} must be an "H S% L%" triple, got ${JSON.stringify(value)}`);
    }
  }

  if (block.colors.ring === block.colors.border) {
    fail(`${label}: --ring must never equal --border (spec.md section 5.3)`);
  }

  for (const [subjectKey, backgroundKey, minimum, gateLabel] of CONTRAST_GATES) {
    const ratio = contrastRatio(block.colors[subjectKey], block.colors[backgroundKey]);
    if (ratio < minimum - 1e-9) {
      fail(`${label}: ${gateLabel} contrast is ${ratio.toFixed(2)}:1, needs >= ${minimum}:1 (spec.md section 9)`);
    }
  }
};

export const validateStyle = (id, style) => {
  if (!STYLE_ID_PATTERN.test(id)) {
    fail(`style id ${JSON.stringify(id)} must be kebab-case, matching ${STYLE_ID_PATTERN}`);
  }
  requireMapping(style, `styles.${id}`);
  requireNonEmptyString(style.name, `styles.${id}.name`);
  requireNonEmptyString(style.description, `styles.${id}.description`);

  if (!Array.isArray(style.modes) || style.modes.length === 0) {
    fail(`styles.${id}.modes must be a non-empty array`);
  }
  const modeSet = new Set(style.modes);
  if (modeSet.size !== style.modes.length || [...modeSet].some((mode) => !ALLOWED_MODES.includes(mode))) {
    fail(`styles.${id}.modes must be a subset of ${JSON.stringify(ALLOWED_MODES)} with no duplicates`);
  }

  for (const mode of ALLOWED_MODES) {
    const declaresMode = modeSet.has(mode);
    const hasBlock = style[mode] !== undefined;
    if (declaresMode !== hasBlock) {
      fail(`styles.${id}: modes ${JSON.stringify(style.modes)} and the presence of a "${mode}:" block disagree`);
    }
    if (hasBlock) {
      validateModeBlock(id, mode, style[mode]);
    }
  }
};

/**
 * Style ids are the persisted setting value (spec.md section 6.4), so a retired id must be
 * declared, not silently dropped, or a stored value downgrades to the compiled default with no
 * record of why. Vacuous on the very first compile, when no previous generated output exists yet.
 */
const checkNoSilentRetirement = (config, previousIds) => {
  if (previousIds === null) return;
  const retired = new Set(config.retired ?? []);
  const currentIds = new Set(Object.keys(config.styles));
  const droppedWithoutNotice = previousIds.filter((id) => !currentIds.has(id) && !retired.has(id));
  if (droppedWithoutNotice.length > 0) {
    fail(
      `style id(s) disappeared without a "retired:" entry: ${droppedWithoutNotice.join(", ")} ` +
        `(styles/appearance-styles.yaml)`,
    );
  }
};

/** Extracts the previously-generated style ids from appStyles.ts, or null if it does not exist yet. */
const readPreviousStyleIds = (tsOutputPath) => {
  let text;
  try {
    text = readFileSync(tsOutputPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const matches = [...text.matchAll(/id:\s*"([a-z0-9-]+)"/g)];
  return matches.map((match) => match[1]);
};

export const loadConfig = ({ yamlPath = DEFAULT_SOURCE_PATH, tsOutputPath = DEFAULT_TS_OUTPUT_PATH } = {}) => {
  const raw = readFileSync(yamlPath, "utf8");
  const config = yaml.load(raw);
  requireMapping(config, "styles/appearance-styles.yaml");
  if (config.schema_version !== 1) {
    fail(`unsupported schema_version: ${JSON.stringify(config.schema_version)} (expected 1)`);
  }
  requireMapping(config.styles, "styles");
  if (Object.keys(config.styles).length === 0) {
    fail("styles/appearance-styles.yaml declares no styles");
  }
  requireNonEmptyString(config.default_style, "default_style");
  if (!config.styles[config.default_style]) {
    fail(`default_style ${JSON.stringify(config.default_style)} is not one of the declared styles`);
  }

  for (const [id, style] of Object.entries(config.styles)) {
    validateStyle(id, style);
  }

  if (config.device_scheme_map !== undefined) {
    requireMapping(config.device_scheme_map, "device_scheme_map");
    for (const [scheme, styleId] of Object.entries(config.device_scheme_map)) {
      requireNonEmptyString(scheme, "device_scheme_map key");
      if (!config.styles[styleId]) {
        fail(`device_scheme_map[${JSON.stringify(scheme)}] = ${JSON.stringify(styleId)} is not a declared style`);
      }
    }
  }

  checkNoSilentRetirement(config, readPreviousStyleIds(tsOutputPath));

  return config;
};

const renderModeBlockLiteral = (block, indent) => {
  const pad = " ".repeat(indent);
  const colorEntries = REQUIRED_COLOR_KEYS.map(
    (key) => `${pad}    ${JSON.stringify(key)}: ${JSON.stringify(block.colors[key])},`,
  ).join("\n");
  const appBarBandLine =
    block.app_bar_band !== undefined ? `${pad}  appBarBand: ${JSON.stringify(block.app_bar_band)},\n` : "";
  return `{
${pad}  radius: ${JSON.stringify(block.radius)},
${pad}  edge: ${JSON.stringify(block.edge)},
${pad}  edgeWidthPx: ${EDGE_WIDTH_PX[block.edge]},
${pad}  ringStyle: ${JSON.stringify(block.ring_style)},
${appBarBandLine}${pad}  colors: {
${colorEntries}
${pad}  },
${pad}}`;
};

export const renderTs = (config) => {
  // Generated from REQUIRED_COLOR_KEYS rather than written out, so the emitted type cannot drift
  // from the set the validator enforces — adding a key in one place and not the other made the
  // committed appStyles.ts fail typecheck while every unit test still passed.
  const colorInterfaceLines = REQUIRED_COLOR_KEYS.map(
    (key) => `  readonly ${/^[a-z][a-zA-Z0-9]*$/.test(key) ? key : JSON.stringify(key)}: string;`,
  ).join("\n");
  const styleEntries = Object.entries(config.styles)
    .map(([id, style]) => {
      const lightLine = style.light ? `    light: ${renderModeBlockLiteral(style.light, 4)},\n` : "";
      const darkLine = style.dark ? `    dark: ${renderModeBlockLiteral(style.dark, 4)},\n` : "";
      return `  {
    id: ${JSON.stringify(id)},
    name: ${JSON.stringify(style.name)},
    description: ${JSON.stringify(style.description)},
    modes: ${JSON.stringify(style.modes)} as const,
${lightLine}${darkLine}  },`;
    })
    .join("\n");

  return `/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * GENERATED by scripts/compile-styles.mjs from styles/appearance-styles.yaml — do not edit by hand.
 *
 * See docs/plans/appearance-styles/spec.md for the token contract (section 5), the style
 * catalogue (section 6) and the compile-time invariants (section 8) this file was checked against.
 */

export type AppStyleEdge = "hairline" | "heavy" | "gloss";
export type AppStyleRingStyle = "solid" | "inverse" | "glow";
export type AppStyleMode = "light" | "dark";

export interface AppStyleColors {
${colorInterfaceLines}
}

export interface AppStyleModeTokens {
  /** Base corner radius, e.g. "12px". --radius-panel derives from this at runtime. */
  readonly radius: string;
  readonly edge: AppStyleEdge;
  /** D10: the edge may only ever be rendered as an inset shadow. 1 for hairline/gloss, 2 for heavy. */
  readonly edgeWidthPx: number;
  readonly ringStyle: AppStyleRingStyle;
  /** Only vault-black declares this: a gradient for the app bar's existing border-image. */
  readonly appBarBand?: string;
  readonly colors: AppStyleColors;
}

export interface AppStyle {
  /** Stable, persisted setting value. Never renamed once shipped (spec.md section 6.4). */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly modes: readonly AppStyleMode[];
  readonly light?: AppStyleModeTokens;
  readonly dark?: AppStyleModeTokens;
}

export const APP_STYLES: readonly AppStyle[] = [
${styleEntries}
];

/** The style every app installs with, and the fallback for an unknown stored id (spec.md section 7.1). */
export const DEFAULT_APP_STYLE_ID = ${JSON.stringify(config.default_style)};

/** "Match my device" (spec.md section 7.4): the Ultimate's own Color Scheme name -> app style id. */
export const DEVICE_SCHEME_TO_STYLE_ID: Readonly<Record<string, string>> = ${JSON.stringify(
    config.device_scheme_map ?? {},
    null,
    2,
  )};
`;
};

const cssVarLines = (block, indent) => {
  const pad = " ".repeat(indent);
  const colorLines = REQUIRED_COLOR_KEYS.map((key) => {
    const cssName = CSS_PROPERTY_NAME[key] ?? key;
    return `${pad}--${cssName}: ${block.colors[key]};`;
  }).join("\n");
  const lines = [
    `${pad}--radius: ${block.radius};`,
    `${pad}--edge-width: ${EDGE_WIDTH_PX[block.edge]}px;`,
    `${pad}--ring-style: ${block.ring_style};`,
    colorLines,
    `${pad}--input: ${block.colors.border};`,
  ];
  if (block.app_bar_band !== undefined) {
    lines.push(`${pad}--app-bar-band: ${block.app_bar_band};`);
  }
  return lines.join("\n");
};

export const renderCss = (config) => {
  const blocks = Object.entries(config.styles)
    .flatMap(([id, style]) => {
      const rules = [];
      if (style.light) {
        rules.push(`html[data-app-style="${id}"] {\n${cssVarLines(style.light, 2)}\n}`);
      }
      if (style.dark) {
        rules.push(`html[data-app-style="${id}"].dark {\n${cssVarLines(style.dark, 2)}\n}`);
      }
      return rules;
    })
    .join("\n\n");

  return `/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * GENERATED by scripts/compile-styles.mjs from styles/appearance-styles.yaml — do not edit by hand.
 *
 * Imported by src/index.css after the base :root / .dark blocks, so these selectors win by
 * specificity without !important. A single-mode style emits only its one rule; the runtime clamps
 * data-app-style and the .dark class together for it.
 */

${blocks}
`;
};

const formatGenerated = async (rendered, outputPath) => {
  const config = (await prettier.resolveConfig(outputPath)) ?? {};
  return prettier.format(rendered, { ...config, filepath: outputPath });
};

const writeOrCheck = ({ outputPath, rendered, check, checkCommand }) => {
  if (check) {
    let existing = "";
    try {
      existing = readFileSync(outputPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (existing !== rendered) {
      fail(`generated file is out of date: ${relative(REPO_ROOT, outputPath)}\n  run: ${checkCommand}`);
    }
    return false;
  }

  let existing = null;
  try {
    existing = readFileSync(outputPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing === rendered) return false;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered, "utf8");
  return true;
};

export const countPalettes = (config) =>
  Object.values(config.styles).reduce((total, style) => total + style.modes.length, 0);

/**
 * Load, validate, render and (unless `check`) write both generated files. Mirrors the
 * `compileVariant`/`compileFeatureFlags` contract: parameterized paths so tests can point it at a
 * temp directory, throws StyleCompileError (never process.exit) on any failure.
 */
export const compileStyles = async ({
  yamlPath = DEFAULT_SOURCE_PATH,
  tsOutputPath = DEFAULT_TS_OUTPUT_PATH,
  cssOutputPath = DEFAULT_CSS_OUTPUT_PATH,
  check = false,
} = {}) => {
  const config = loadConfig({ yamlPath, tsOutputPath });

  const renderedTs = await formatGenerated(renderTs(config), tsOutputPath);
  const renderedCss = await formatGenerated(renderCss(config), cssOutputPath);

  const checkCommand = "node scripts/compile-styles.mjs";
  const tsChanged = writeOrCheck({ outputPath: tsOutputPath, rendered: renderedTs, check, checkCommand });
  const cssChanged = writeOrCheck({ outputPath: cssOutputPath, rendered: renderedCss, check, checkCommand });

  return { config, tsChanged, cssChanged, paletteCount: countPalettes(config) };
};

const isDirectInvocation = () => {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
};

if (isDirectInvocation()) {
  const check = process.argv.includes("--check");
  try {
    const { tsChanged, cssChanged, paletteCount, config } = await compileStyles({ check });
    if (check) {
      console.log(`styles check: ${paletteCount} palette(s) up to date`);
    } else {
      console.log(
        `wrote ${relative(REPO_ROOT, DEFAULT_TS_OUTPUT_PATH)} and ${relative(REPO_ROOT, DEFAULT_CSS_OUTPUT_PATH)} ` +
          `(${Object.keys(config.styles).length} styles, ${paletteCount} palettes)` +
          (tsChanged || cssChanged ? "" : " (unchanged)"),
      );
    }
  } catch (error) {
    if (error instanceof StyleCompileError) {
      console.error(`error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
