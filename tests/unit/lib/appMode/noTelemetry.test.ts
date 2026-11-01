/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");

const TELEMETRY_PACKAGES =
  /@sentry|sentry-capacitor|firebase|@firebase|google-analytics|gtag|mixpanel|amplitude|segment|posthog|bugsnag|datadog|crashlytics|appcenter|@capacitor-firebase|plausible|matomo/i;
const TELEMETRY_ENDPOINTS =
  /(?:sentry\.io|google-analytics\.com|googletagmanager\.com|app-measurement\.com|firebaseio\.com|crashlytics\.com|mixpanel\.com|amplitude\.com|segment\.io|posthog\.com|bugsnag\.com|datadoghq\.com|plausible\.io|matomo)/i;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });

describe("SPM-PRIV-01 no telemetry", () => {
  it("no module sends data to an analytics or crash service", () => {
    const offenders = sourceFiles(path.join(ROOT, "src")).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return TELEMETRY_ENDPOINTS.test(text) ||
        /from\s+["'][^"']*(sentry|firebase|mixpanel|amplitude|bugsnag)/i.test(text)
        ? [path.relative(ROOT, file)]
        : [];
    });
    expect(offenders).toEqual([]);
  });

  it("no dependency is an analytics or crash reporting package", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(names.filter((name) => TELEMETRY_PACKAGES.test(name))).toEqual([]);
  });
});
