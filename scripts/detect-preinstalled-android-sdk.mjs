#!/usr/bin/env node

import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const DEFAULT_ANDROID_SDK_ROOTS = ["/usr/local/lib/android/sdk"];

const normalizeCandidateRoots = (roots) => {
  const seen = new Set();
  const candidates = [];

  for (const root of roots) {
    if (typeof root !== "string") {
      continue;
    }

    const trimmed = root.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = path.resolve(trimmed);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    candidates.push(normalized);
  }

  return candidates;
};

export const getAndroidSdkRootCandidates = (env = process.env) =>
  normalizeCandidateRoots([
    env.ANDROID_SDK_ROOT,
    env.ANDROID_HOME,
    ...DEFAULT_ANDROID_SDK_ROOTS,
    env.HOME ? path.join(env.HOME, "Android", "Sdk") : "",
  ]);

const readSourceProperties = async (sourcePropertiesPath) => {
  try {
    return await readFile(sourcePropertiesPath, "utf8");
  } catch {
    return "";
  }
};

const parseCmdlineToolsRevision = (sourceProperties) => {
  const match = sourceProperties.match(/^Pkg\.Revision=(.+)$/m);
  return match ? match[1].trim() : "";
};

export const resolvePreinstalledAndroidSdk = async (
  env = process.env,
  candidateRoots = getAndroidSdkRootCandidates(env),
) => {
  for (const sdkRoot of normalizeCandidateRoots(candidateRoots)) {
    const sdkmanagerPath = path.join(sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager");
    const cmdlineToolsBin = path.dirname(sdkmanagerPath);
    const platformToolsBin = path.join(sdkRoot, "platform-tools");
    const emulatorBin = path.join(sdkRoot, "emulator");

    try {
      await access(sdkmanagerPath, fsConstants.X_OK);
    } catch {
      continue;
    }

    const sourcePropertiesPath = path.join(sdkRoot, "cmdline-tools", "latest", "source.properties");
    const sourceProperties = await readSourceProperties(sourcePropertiesPath);

    return {
      usePreinstalled: true,
      androidSdkRoot: sdkRoot,
      androidHome: sdkRoot,
      sdkmanagerPath,
      cmdlineToolsBin,
      platformToolsBin,
      emulatorBin,
      cmdlineToolsRevision: parseCmdlineToolsRevision(sourceProperties),
      sourceProperties,
    };
  }

  return {
    usePreinstalled: false,
    androidSdkRoot: "",
    androidHome: "",
    sdkmanagerPath: "",
    cmdlineToolsBin: "",
    platformToolsBin: "",
    emulatorBin: "",
    cmdlineToolsRevision: "",
    sourceProperties: "",
  };
};

const emitGitHubOutputs = (result) => {
  process.stdout.write(`use_preinstalled=${result.usePreinstalled ? "true" : "false"}\n`);
  process.stdout.write(`android_sdk_root=${result.androidSdkRoot}\n`);
  process.stdout.write(`android_home=${result.androidHome}\n`);
  process.stdout.write(`sdkmanager_path=${result.sdkmanagerPath}\n`);
  process.stdout.write(`cmdline_tools_bin=${result.cmdlineToolsBin}\n`);
  process.stdout.write(`platform_tools_bin=${result.platformToolsBin}\n`);
  process.stdout.write(`emulator_bin=${result.emulatorBin}\n`);
  process.stdout.write(`cmdline_tools_revision=${result.cmdlineToolsRevision}\n`);
};

const main = async () => {
  const result = await resolvePreinstalledAndroidSdk(process.env);
  emitGitHubOutputs(result);

  if (result.usePreinstalled) {
    const revision = result.cmdlineToolsRevision || "unknown";
    console.error(`Using preinstalled Android SDK at ${result.androidSdkRoot} (cmdline-tools ${revision}).`);
    return;
  }

  console.error("No preinstalled Android SDK with sdkmanager found; falling back to setup-android.");
};

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
