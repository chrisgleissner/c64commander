#!/usr/bin/env node
/*
 * Builds — and optionally deploys — the Android debug APK for the selected
 * variants in one run, so the canonical "build the Android app" command produces
 * both the C64 Commander APK and the C64U Remote APK (and any future published
 * variant), and a single invocation can also uninstall, install, verify, and
 * reset app configuration on a connected device.
 *
 * For each variant it:
 *   1. regenerates variant + feature-flag outputs for that variant (APP_VARIANT),
 *   2. builds the web bundle and syncs Capacitor for Android,
 *   3. runs `./gradlew assembleDebug`,
 *   4. locates the produced APK (named "<exported_file_basename>-<version>-debug.apk"),
 *   5. optionally verifies the APK metadata (label + application id),
 *   6. optionally uninstalls the prior install, installs the fresh APK, resets
 *      app config (`adb shell pm clear`), and verifies the package is installed.
 *
 * The build log clearly states which variant produced which APK and which
 * package/serial it was deployed to. The script fails loudly if the Android
 * toolchain is unavailable — it never silently builds only one APK.
 *
 * Usage:
 *   node scripts/build-android-apks.mjs [--target ci|release]
 *        [--variant commander|remote|all] [--variants a,b]
 *        [--verify-metadata] [--install] [--uninstall-first] [--reset-config]
 *        [--device <adb-serial>] [--skip-build] [--help]
 *
 * Examples:
 *   # Build + deploy BOTH variants to the only connected device, wiping config:
 *   node scripts/build-android-apks.mjs --variant all --install --uninstall-first --reset-config
 *   # Just clear persisted config for both variants (fresh-install scenario setup):
 *   node scripts/build-android-apks.mjs --variant all --reset-config --skip-build
 *   # Build + deploy only C64U Remote to a specific device:
 *   node scripts/build-android-apks.mjs --variant remote --install --device 9B081FFAZ001WX
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseVariantSource, resolvePublishVariants } from "./generate-variant.mjs";
import { verifyApkMetadata } from "./verify-apk-metadata.mjs";
import { verifyApkNoGms } from "./verify-apk-no-gms.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const APK_DEBUG_DIR = path.join(REPO_ROOT, "android/app/build/outputs/apk/debug");
// The Android Gradle Plugin cleans stale APKs from the shared per-build-type
// output directory, so when several variants are built sequentially only the
// last one survives there. We copy each variant's APK into a stable collection
// directory so BOTH (all) APKs persist after a single `android:apk:all` run.
const COLLECT_DIR = path.join(REPO_ROOT, "artifacts/android-apks");

// `--variant <alias>` maps a friendly name onto the canonical variant id used in
// variants.yaml. Raw variant ids are also accepted.
export const VARIANT_ALIASES = {
  commander: "c64commander",
  remote: "c64u-remote",
};

export const HELP_TEXT = `build-android-apks — build and optionally deploy the Android variant APK(s)

Options:
  --target ci|release        Publish target used to resolve the default variant set (default: ci)
  --variant commander|remote|all
                             Select a variant by friendly name; "all" = every published variant
  --variants <a,b>           Select variants by raw id (comma-separated)
  --verify-metadata          Verify each APK's label + application id (and no-GMS)
  --install                  Install the built (or existing) APK(s) onto the device
  --uninstall-first          Uninstall any prior install of each package before installing
  --reset-config             Clear persisted app config for each package (adb shell pm clear)
  --device <adb-serial>      Target a specific adb device serial
  --skip-build               Skip building; operate on existing APKs / installed packages
  --help, -h                 Show this help

Examples:
  node scripts/build-android-apks.mjs --variant all --install --uninstall-first --reset-config
  node scripts/build-android-apks.mjs --variant all --reset-config --skip-build
  node scripts/build-android-apks.mjs --variant remote --install --device 9B081FFAZ001WX
`;

export const parseArgs = (argv) => {
  const args = {
    target: "ci",
    explicitVariants: null,
    variantAlias: null,
    verifyMetadata: false,
    install: false,
    uninstallFirst: false,
    resetConfig: false,
    deviceSerial: null,
    skipBuild: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      args.target = argv[(i += 1)];
    } else if (arg === "--variants") {
      args.explicitVariants = (argv[(i += 1)] ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (arg === "--variant") {
      args.variantAlias = (argv[(i += 1)] ?? "").trim();
    } else if (arg === "--verify-metadata") {
      args.verifyMetadata = true;
    } else if (arg === "--install") {
      args.install = true;
    } else if (arg === "--uninstall-first") {
      args.uninstallFirst = true;
    } else if (arg === "--reset-config") {
      args.resetConfig = true;
    } else if (arg === "--device") {
      args.deviceSerial = (argv[(i += 1)] ?? "").trim();
    } else if (arg === "--skip-build") {
      args.skipBuild = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
};

/**
 * Resolve the selected variant ids from CLI args. Preserves the legacy behaviour:
 * no `--variant`/`--variants` → the published set for `--target` (CI default).
 */
export const resolveSelectedVariantIds = (config, args) => {
  if (args.variantAlias && args.variantAlias !== "all") {
    const id = VARIANT_ALIASES[args.variantAlias] ?? args.variantAlias;
    if (!config.variants[id]) {
      throw new Error(`unknown variant: ${args.variantAlias}`);
    }
    return [id];
  }
  return resolvePublishVariants(config, {
    publishTarget: args.target,
    explicitVariants: args.explicitVariants,
  });
};

const adbBaseArgs = (deviceSerial) => (deviceSerial ? ["-s", deviceSerial] : []);

/**
 * Pure planner: returns the ordered list of adb steps for one variant, WITHOUT
 * executing them. Each step is { command, args, description, tolerateFailure?, verify? }.
 * Exported so tests can assert the deploy/reset/uninstall plan deterministically.
 */
export const planVariantAdbSteps = ({
  applicationId,
  apkPath = null,
  deviceSerial = null,
  uninstallFirst = false,
  install = false,
  resetConfig = false,
}) => {
  const base = adbBaseArgs(deviceSerial);
  const steps = [];
  if (uninstallFirst) {
    steps.push({
      command: "adb",
      args: [...base, "uninstall", applicationId],
      description: `uninstall ${applicationId}`,
      tolerateFailure: true,
    });
  }
  if (install) {
    if (!apkPath) {
      throw new Error(
        `--install requested for ${applicationId} but no APK is available (build was skipped and none was found)`,
      );
    }
    steps.push({
      command: "adb",
      args: [...base, "install", "-r", "-d", apkPath],
      description: `install ${path.basename(apkPath)}`,
    });
  }
  if (resetConfig) {
    steps.push({
      command: "adb",
      args: [...base, "shell", "pm", "clear", applicationId],
      description: `reset config (pm clear ${applicationId})`,
    });
  }
  // Verify the package is present whenever we expect it to be installed.
  if (install || resetConfig) {
    steps.push({
      command: "adb",
      args: [...base, "shell", "pm", "list", "packages", applicationId],
      description: `verify ${applicationId} installed`,
      verify: applicationId,
    });
  }
  return steps;
};

const run = (command, commandArgs, env) => {
  console.log(`\n$ ${command} ${commandArgs.join(" ")}`);
  execFileSync(command, commandArgs, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
};

// Locate a variant's APK. The APK basename is VERSION-based, not content-hashed, so a
// stale copy in COLLECT_DIR from a previous build shares the same filename as a fresh
// one. For a fresh build we MUST resolve the Gradle output (APK_DEBUG_DIR) first — the
// collected copy is stale and would be installed instead of the just-built APK. Only the
// --skip-build path (no fresh Gradle output) prefers the collected copy.
// Directory search order. Fresh build → Gradle output first; --skip-build → collected first.
export const apkSearchDirs = (preferCollected = false) =>
  preferCollected ? [COLLECT_DIR, APK_DEBUG_DIR] : [APK_DEBUG_DIR, COLLECT_DIR];

export const findApk = (basename, { preferCollected = false } = {}) => {
  const dirs = apkSearchDirs(preferCollected);
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const match = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(`${basename}-`) && name.endsWith(".apk"))
      .map((name) => path.join(dir, name))[0];
    if (match) return match;
  }
  return null;
};

const resolveDeviceSerial = (explicit) => {
  if (explicit) return explicit;
  const out = execFileSync("adb", ["devices"], { cwd: REPO_ROOT, encoding: "utf8" });
  const serials = out
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /\tdevice$/.test(line))
    .map((line) => line.split("\t")[0]);
  if (serials.length === 1) return serials[0];
  if (serials.length === 0) throw new Error("no adb device connected; pass --device <serial>");
  throw new Error(`multiple adb devices connected (${serials.join(", ")}); pass --device <serial>`);
};

const executeAdbStep = (step) => {
  console.log(`\n$ ${step.command} ${step.args.join(" ")}   # ${step.description}`);
  try {
    const out = execFileSync(step.command, step.args, { cwd: REPO_ROOT, encoding: "utf8" });
    if (out.trim()) console.log(out.trim());
    if (step.verify && !out.includes(step.verify)) {
      throw new Error(`verification failed: package ${step.verify} is not installed`);
    }
    return out;
  } catch (error) {
    if (step.tolerateFailure) {
      console.log(`   (tolerated) ${error instanceof Error ? error.message : String(error)}`);
      return "";
    }
    throw error;
  }
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }
  const config = parseVariantSource(fs.readFileSync(path.join(REPO_ROOT, "variants/variants.yaml"), "utf8"), {
    repoRoot: REPO_ROOT,
  });
  const variantIds = resolveSelectedVariantIds(config, args);

  const deploy = args.install || args.uninstallFirst || args.resetConfig;
  const deviceSerial = deploy ? resolveDeviceSerial(args.deviceSerial) : args.deviceSerial;

  console.log(`Variant(s): ${variantIds.join(", ")}`);
  if (deploy) console.log(`Target device: ${deviceSerial}`);
  if (args.skipBuild) console.log("Skipping build (operating on existing APKs / installed packages).");

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const built = [];

  for (const variantId of variantIds) {
    const variant = config.variants[variantId];
    const applicationId = variant.platform.android.applicationId;
    console.log(`\n========== Variant: ${variantId} (${variant.displayName}) ==========`);

    let apkPath = null;
    if (!args.skipBuild) {
      // Regenerate variant outputs + web bundle + Capacitor sync for THIS variant.
      run(npmCmd, ["run", "cap:build"], { APP_VARIANT: variantId });
      // Build the debug APK.
      execFileSync(gradlew, ["assembleDebug", "--warning-mode", "none"], {
        cwd: path.join(REPO_ROOT, "android"),
        stdio: "inherit",
        env: { ...process.env, APP_VARIANT: variantId },
      });

      const builtApkPath = findApk(variant.exportedFileBasename);
      if (!builtApkPath) {
        throw new Error(
          `expected an APK starting with "${variant.exportedFileBasename}-" in ${APK_DEBUG_DIR} for variant ${variantId}, but found none`,
        );
      }
      // Persist the APK into the stable collection dir so it survives the next
      // variant's Gradle run.
      fs.mkdirSync(COLLECT_DIR, { recursive: true });
      apkPath = path.join(COLLECT_DIR, path.basename(builtApkPath));
      if (path.resolve(builtApkPath) !== path.resolve(apkPath)) {
        fs.copyFileSync(builtApkPath, apkPath);
      }
    } else {
      apkPath = findApk(variant.exportedFileBasename, { preferCollected: true });
    }

    const record = {
      variant: variantId,
      displayName: variant.displayName,
      applicationId,
      apkPath,
      sizeBytes: apkPath && fs.existsSync(apkPath) ? fs.statSync(apkPath).size : null,
      deviceSerial: deploy ? deviceSerial : null,
    };

    if (args.verifyMetadata && apkPath) {
      record.metadata = verifyApkMetadata(apkPath, {
        expectApplicationId: applicationId,
        expectLabel: variant.displayName,
      });
      record.gms = verifyApkNoGms(apkPath);
    }

    if (deploy) {
      const steps = planVariantAdbSteps({
        applicationId,
        apkPath,
        deviceSerial,
        uninstallFirst: args.uninstallFirst,
        install: args.install,
        resetConfig: args.resetConfig,
      });
      for (const step of steps) executeAdbStep(step);
      record.deployed = true;
    }

    built.push(record);
    const sizeLabel = record.sizeBytes != null ? `${(record.sizeBytes / 1024 / 1024).toFixed(2)} MiB` : "n/a";
    console.log(`-> ${variantId}: ${apkPath ? path.relative(REPO_ROOT, apkPath) : "(no apk)"} (${sizeLabel})`);
  }

  console.log("\n=== Android APK build/deploy summary ===");
  for (const record of built) {
    console.log(
      `${record.variant.padEnd(14)} | ${record.applicationId.padEnd(28)} | label="${record.displayName}" | ` +
        `${record.apkPath ? path.relative(REPO_ROOT, record.apkPath) : "(no apk)"}` +
        (record.deviceSerial ? ` | device=${record.deviceSerial}${record.deployed ? " (deployed)" : ""}` : ""),
    );
  }
  if (!args.skipBuild) {
    console.log(
      `\n${built.filter((r) => r.apkPath).length} APK(s) collected in ${path.relative(REPO_ROOT, COLLECT_DIR)}/`,
    );
    // Building each variant regenerates src/generated/variant.ts (+ feature-flag registry) for
    // THAT variant via APP_VARIANT, leaving the working tree's generated files on the last-built
    // variant. That breaks `variant:check` and variant-dependent unit tests. Restore the default
    // variant's generated outputs so the tree returns to its canonical (committed) state.
    console.log("\nRestoring default-variant generated outputs...");
    run(npmCmd, ["run", "variant:generate"], { APP_VARIANT: "" });
    run(npmCmd, ["run", "feature-flags:compile"], { APP_VARIANT: "" });
  }
};

// Only run main when invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`\nbuild-android-apks failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
