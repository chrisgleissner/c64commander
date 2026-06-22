/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HELP_TEXT,
  VARIANT_ALIASES,
  apkSearchDirs,
  parseArgs,
  planVariantAdbSteps,
  resolveSelectedVariantIds,
} from "../../../scripts/build-android-apks.mjs";
import { parseVariantSource } from "../../../scripts/generate-variant.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const loadRealConfig = () =>
  parseVariantSource(fs.readFileSync(path.join(REPO_ROOT, "variants/variants.yaml"), "utf8"), { repoRoot: REPO_ROOT });

// Minimal config stub for alias resolution (only `variants[id]` presence matters).
const fakeConfig = {
  variants: {
    c64commander: {
      platform: { android: { applicationId: "uk.gleissner.c64commander" } },
      displayName: "C64 Commander",
    },
    "c64u-remote": { platform: { android: { applicationId: "uk.gleissner.c64uremote" } }, displayName: "C64U Remote" },
  },
};

describe("build-android-apks parseArgs", () => {
  it("defaults to the ci target and build-only mode", () => {
    const args = parseArgs([]);
    expect(args.target).toBe("ci");
    expect(args.install).toBe(false);
    expect(args.uninstallFirst).toBe(false);
    expect(args.resetConfig).toBe(false);
    expect(args.skipBuild).toBe(false);
    expect(args.variantAlias).toBeNull();
  });

  it("parses the deploy flags and the variant alias + device serial", () => {
    const args = parseArgs([
      "--variant",
      "all",
      "--install",
      "--uninstall-first",
      "--reset-config",
      "--device",
      "9B081FFAZ001WX",
      "--skip-build",
    ]);
    expect(args.variantAlias).toBe("all");
    expect(args.install).toBe(true);
    expect(args.uninstallFirst).toBe(true);
    expect(args.resetConfig).toBe(true);
    expect(args.deviceSerial).toBe("9B081FFAZ001WX");
    expect(args.skipBuild).toBe(true);
  });

  it("supports --help and -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("throws on unknown arguments", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
  });
});

describe("build-android-apks resolveSelectedVariantIds", () => {
  it("maps --variant commander/remote to canonical ids", () => {
    expect(VARIANT_ALIASES.commander).toBe("c64commander");
    expect(VARIANT_ALIASES.remote).toBe("c64u-remote");
    expect(resolveSelectedVariantIds(fakeConfig, parseArgs(["--variant", "commander"]))).toEqual(["c64commander"]);
    expect(resolveSelectedVariantIds(fakeConfig, parseArgs(["--variant", "remote"]))).toEqual(["c64u-remote"]);
  });

  it("throws for an unknown variant alias", () => {
    expect(() => resolveSelectedVariantIds(fakeConfig, parseArgs(["--variant", "nope"]))).toThrow(/unknown variant/);
  });

  it("--variant all and the default both resolve to the published set (both variants)", () => {
    const config = loadRealConfig();
    const all = resolveSelectedVariantIds(config, parseArgs(["--variant", "all"]));
    const def = resolveSelectedVariantIds(config, parseArgs([]));
    expect(all).toEqual(expect.arrayContaining(["c64commander", "c64u-remote"]));
    expect(def).toEqual(all);
  });

  it("resolves the package names for both variants", () => {
    const config = loadRealConfig();
    expect(config.variants.c64commander.platform.android.applicationId).toBe("uk.gleissner.c64commander");
    expect(config.variants["c64u-remote"].platform.android.applicationId).toBe("uk.gleissner.c64uremote");
  });
});

describe("build-android-apks planVariantAdbSteps", () => {
  const pkg = "uk.gleissner.c64commander";

  it("plans install + verify for a basic install", () => {
    const steps = planVariantAdbSteps({ applicationId: pkg, apkPath: "/tmp/app.apk", install: true });
    expect(steps.map((s) => s.description)).toEqual(["install app.apk", `verify ${pkg} installed`]);
    expect(steps[0].args).toEqual(["install", "-r", "-d", "/tmp/app.apk"]);
    expect(steps[1].verify).toBe(pkg);
  });

  it("orders uninstall-first → install → reset-config → verify", () => {
    const steps = planVariantAdbSteps({
      applicationId: pkg,
      apkPath: "/tmp/app.apk",
      uninstallFirst: true,
      install: true,
      resetConfig: true,
    });
    expect(steps.map((s) => s.args.join(" "))).toEqual([
      `uninstall ${pkg}`,
      "install -r -d /tmp/app.apk",
      `shell pm clear ${pkg}`,
      `shell pm list packages ${pkg}`,
    ]);
    expect(steps[0].tolerateFailure).toBe(true);
  });

  it("plans reset-config alone (scenario setup, no build/install)", () => {
    const steps = planVariantAdbSteps({ applicationId: pkg, resetConfig: true });
    expect(steps.map((s) => s.args.join(" "))).toEqual([`shell pm clear ${pkg}`, `shell pm list packages ${pkg}`]);
  });

  it("prefixes every step with -s <serial> when a device serial is given", () => {
    const steps = planVariantAdbSteps({
      applicationId: pkg,
      apkPath: "/tmp/app.apk",
      deviceSerial: "SERIAL123",
      install: true,
    });
    for (const step of steps) {
      expect(step.args.slice(0, 2)).toEqual(["-s", "SERIAL123"]);
    }
  });

  it("does not verify when only uninstalling", () => {
    const steps = planVariantAdbSteps({ applicationId: pkg, uninstallFirst: true });
    expect(steps).toHaveLength(1);
    expect(steps[0].args).toEqual(["uninstall", pkg]);
  });

  it("throws when install is requested without an APK", () => {
    expect(() => planVariantAdbSteps({ applicationId: pkg, install: true })).toThrow(/no APK is available/);
  });
});

describe("build-android-apks apkSearchDirs", () => {
  it("resolves the fresh Gradle output (apk/debug) BEFORE the collected copy for a fresh build", () => {
    const [first, second] = apkSearchDirs(false);
    // Regression guard: the version-named APK in artifacts/ is stale across rebuilds, so a
    // fresh build must NOT resolve it first (that installed pre-change APKs).
    expect(first.replace(/\\/g, "/")).toMatch(/android\/app\/build\/outputs\/apk\/debug$/);
    expect(second.replace(/\\/g, "/")).toMatch(/artifacts\/android-apks$/);
  });

  it("prefers the collected copy when build is skipped (no fresh Gradle output)", () => {
    const [first] = apkSearchDirs(true);
    expect(first.replace(/\\/g, "/")).toMatch(/artifacts\/android-apks$/);
  });
});

describe("build-android-apks HELP_TEXT", () => {
  it("documents the new deploy options", () => {
    for (const option of [
      "--variant",
      "--install",
      "--uninstall-first",
      "--reset-config",
      "--device",
      "--skip-build",
    ]) {
      expect(HELP_TEXT).toContain(option);
    }
  });
});
