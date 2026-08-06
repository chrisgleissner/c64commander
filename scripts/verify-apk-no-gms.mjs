#!/usr/bin/env node
/*
 * Asserts that an APK has NO HARD dependency on Google Play Services / Google
 * Mobile Services, so it can install and run on a Google-less environment
 * (an AOSP emulator image or any de-Googled / no-Google-services Android host).
 *
 * Two things are checked.
 *
 * 1. A REQUIRED `<uses-library>` or `<uses-feature>` naming a Google component.
 *    Mere code references to GMS symbols are NOT a hard dependency (the client
 *    libraries degrade gracefully), so only required declarations are flagged.
 *
 * 2. An `androidx.startup` initializer known to resolve through a Google
 *    provider. This exists because check 1 missed a real defect: androidx.emoji2
 *    registers EmojiCompatInitializer, which resolves its font through the GMS
 *    downloadable-font provider, and on a device that HAS Play Services the app
 *    then becomes a client of it - ActivityManager killed the app when that
 *    provider's process died. It declares no uses-library, so check 1 saw
 *    nothing, and a launch test on a Google-less image passes precisely because
 *    the initializer quietly finds no provider there. Neither check could see
 *    it; only a device WITH Google services shows the coupling.
 *
 * Usage:
 *   node scripts/verify-apk-no-gms.mjs <apk> [--json]
 *
 * Tool discovery matches scripts/verify-apk-metadata.mjs (aapt2/aapt).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export class ApkGmsError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApkGmsError";
  }
}

// Google component name fragments that, if declared as a REQUIRED uses-library
// or uses-feature, indicate a hard Google dependency.
const GOOGLE_LIBRARY_MARKERS = ["com.google.android.gms", "com.google.android.maps", "com.google.firebase"];
const GOOGLE_FEATURE_MARKERS = ["com.google.android.gms"];

// androidx.startup initializers that reach a Google provider at runtime. This is an
// explicit list rather than a pattern: most initializers are harmless
// (ProcessLifecycleInitializer, WorkManagerInitializer), and flagging every
// androidx.startup entry would reject builds for no reason.
const GOOGLE_REACHING_INITIALIZERS = [
  {
    name: "androidx.emoji2.text.EmojiCompatInitializer",
    reaches: "the GMS downloadable-font provider (com.google.android.gms.fonts)",
    remedy: 'remove it with tools:node="remove" on its meta-data entry under androidx.startup.InitializationProvider',
  },
];

/**
 * True when `aapt2 dump xmltree` output declares an attribute whose value is exactly
 * `name`. aapt2 renders the meta-data name as `A: android:name(0x01010003)="<value>"`.
 *
 * This is a substring match, not a regex match. `GOOGLE_REACHING_INITIALIZERS` is meant
 * to be extended by hand, and a nested class is written `Outer$Inner`. In a regex `$` is
 * an end-of-input anchor, so a pattern built from such a name would never match the
 * manifest and the entry would be silently ignored. The quotes around the name are part
 * of the needle, so a longer class name that starts with the same characters does not
 * match.
 */
export const declaresInitializer = (xmltree, name) => xmltree.includes(`="${name}"`);

/**
 * Finds Google-reaching startup initializers in `aapt2 dump xmltree` output for
 * AndroidManifest.xml. Pure so it can be tested without an APK.
 */
export const analyzeStartupInitializers = (xmltree) => {
  const found = GOOGLE_REACHING_INITIALIZERS.filter((initializer) => declaresInitializer(xmltree, initializer.name));
  return { initializers: found, ok: found.length === 0 };
};

const looksGoogle = (name, markers) => markers.some((marker) => name.includes(marker));

// Parse `aapt[2] dump badging` for hard Google dependencies.
export const analyzeGmsUsage = (badging) => {
  const requiredLibraries = [];
  const requiredFeatures = [];

  for (const line of badging.split("\n")) {
    const trimmed = line.trim();
    // `uses-library:'name'` is required; `uses-library-not-required:'name'` is optional.
    const libMatch = /^uses-library:'([^']+)'/.exec(trimmed);
    if (libMatch && looksGoogle(libMatch[1], GOOGLE_LIBRARY_MARKERS)) {
      requiredLibraries.push(libMatch[1]);
      continue;
    }
    // `uses-feature:'name'` (required) vs `uses-feature-not-required:'name'`.
    const featMatch = /^uses-feature:'([^']+)'/.exec(trimmed);
    if (featMatch && looksGoogle(featMatch[1], GOOGLE_FEATURE_MARKERS)) {
      requiredFeatures.push(featMatch[1]);
    }
  }

  return {
    requiredLibraries,
    requiredFeatures,
    ok: requiredLibraries.length === 0 && requiredFeatures.length === 0,
  };
};

const candidateTools = () => {
  const tools = [];
  if (process.env.AAPT2) tools.push(process.env.AAPT2);
  if (process.env.AAPT) tools.push(process.env.AAPT);
  for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean)) {
    const dir = path.join(root, "build-tools");
    let versions = [];
    try {
      versions = fs.readdirSync(dir).sort().reverse();
    } catch {
      versions = [];
    }
    for (const v of versions) {
      tools.push(path.join(dir, v, "aapt2"), path.join(dir, v, "aapt"));
    }
  }
  tools.push("aapt2", "aapt");
  return tools;
};

const runBadging = (apkPath) => {
  const errors = [];
  for (const tool of candidateTools()) {
    try {
      return execFileSync(tool, ["dump", "badging", apkPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (error) {
      errors.push(`${tool}: ${error.code === "ENOENT" ? "not found" : error.message}`);
    }
  }
  throw new ApkGmsError(
    `unable to run aapt2/aapt dump badging on ${apkPath}.\n  tried:\n   - ${errors.join("\n   - ")}`,
  );
};

// Returns null rather than throwing when the manifest cannot be dumped: see the call
// site for why this check must not be able to fail a build on tooling problems.
const runManifestXmltree = (apkPath) => {
  for (const tool of candidateTools()) {
    try {
      return execFileSync(tool, ["dump", "xmltree", "--file", "AndroidManifest.xml", apkPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      // Try the next candidate.
    }
  }
  return null;
};

export const verifyApkNoGms = (apkPath) => {
  if (!fs.existsSync(apkPath)) {
    throw new ApkGmsError(`APK not found: ${apkPath}`);
  }
  const result = analyzeGmsUsage(runBadging(apkPath));
  if (!result.ok) {
    throw new ApkGmsError(
      `APK declares a hard Google dependency: libraries=[${result.requiredLibraries.join(", ")}] features=[${result.requiredFeatures.join(", ")}]`,
    );
  }

  // Deliberately fails only on a positive detection. If the manifest cannot be dumped
  // - an older aapt, a tool that is missing - this reports and moves on rather than
  // rejecting the build, because a parsing problem here must never be able to fail
  // every APK build. A false negative costs the extra check; a false positive costs
  // the pipeline.
  let startup = { initializers: [], ok: true, checked: false };
  const xmltree = runManifestXmltree(apkPath);
  if (xmltree === null) {
    console.warn("could not dump AndroidManifest.xml; skipped the startup-initializer check");
  } else {
    startup = { ...analyzeStartupInitializers(xmltree), checked: true };
    if (!startup.ok) {
      const detail = startup.initializers.map((i) => `${i.name} reaches ${i.reaches}; ${i.remedy}`).join("\n  ");
      throw new ApkGmsError(`APK registers a Google-reaching startup initializer:\n  ${detail}`);
    }
  }

  return { ...result, startup };
};

const isDirectInvocation = () => {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
};

if (isDirectInvocation()) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const apkPath = args.find((a) => !a.startsWith("--"));
  try {
    if (!apkPath) throw new ApkGmsError("usage: verify-apk-no-gms.mjs <apk> [--json]");
    const result = verifyApkNoGms(apkPath);
    if (json) {
      console.log(JSON.stringify({ apk: apkPath, ...result }, null, 2));
    } else {
      console.log(`APK ${path.basename(apkPath)} has no hard Google Play Services dependency.`);
    }
  } catch (error) {
    if (error instanceof ApkGmsError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
