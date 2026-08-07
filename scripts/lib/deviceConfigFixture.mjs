/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The configuration a real Ultimate reports, for the mock REST servers to serve.
 *
 * Source is `docs/c64/c64u-config.yaml`, a capture taken from a device: 20 categories and
 * 201 items, each stored as `{ selected, options, details }`. That is already the shape
 * the application's `ConfigResponse` declares, so serving it needs no conversion.
 *
 * Why this exists rather than a payload written into each mock: measured against a real
 * run's request log, the application asks for 14 distinct categories. The hand-written
 * payload the mocks used before answered one of them, `Audio Mixer`. Its second category,
 * `SID Settings`, is one the application never requests at all. Every other category
 * returned an empty envelope, and the Home page renders "Not available" for any item the
 * device does not report - so a walkthrough showed empty Video, User Interface, LED
 * Lighting and Keyboard Lighting cards.
 *
 * It also reported volume options as JSON numbers (`{ selected: 40, options: [0, 20] }`).
 * No device does that; a real one reports decibel strings. `normalizeConfigItem` coerces
 * them now, so it no longer crashes the SID mixer, but a test written against that payload
 * was asserting a shape no device produces.
 *
 * `src/lib/mock/mockConfig.ts` loads the same file for the application's own mock. It is
 * TypeScript consumed by the bundler, and these mocks are plain Node scripts started
 * directly, so the small amount of reshaping below is repeated rather than imported. The
 * data is not: there is one capture, and it is the file below.
 */
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEVICE_CONFIG_PATH = path.resolve(here, "../../docs/c64/c64u-config.yaml");

/**
 * @returns {{ categories: string[], configs: Record<string, Record<string, unknown>> }}
 */
export const loadDeviceConfigFixture = () => {
  const parsed = yaml.load(readFileSync(DEVICE_CONFIG_PATH, "utf8"));
  const rawCategories = parsed?.config?.categories;
  if (!rawCategories || Object.keys(rawCategories).length === 0) {
    throw new Error(`${DEVICE_CONFIG_PATH} is not a device configuration capture: expected config.categories`);
  }

  const configs = Object.fromEntries(
    Object.entries(rawCategories).map(([name, category]) => [name, { ...(category.items ?? {}) }]),
  );
  return { categories: Object.keys(configs), configs };
};
