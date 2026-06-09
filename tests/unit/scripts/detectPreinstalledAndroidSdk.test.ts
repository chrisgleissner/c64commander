import path from "node:path";
import os from "node:os";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
  getAndroidSdkRootCandidates,
  resolvePreinstalledAndroidSdk,
} from "../../../scripts/detect-preinstalled-android-sdk.mjs";

const tempDirs: string[] = [];

const makeTempDir = async (prefix: string) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const createPreinstalledSdk = async (sdkRoot: string, revision = "12.0") => {
  const cmdlineToolsDir = path.join(sdkRoot, "cmdline-tools", "latest");
  const binDir = path.join(cmdlineToolsDir, "bin");
  await mkdir(binDir, { recursive: true });
  const sdkmanagerPath = path.join(binDir, "sdkmanager");
  await writeFile(sdkmanagerPath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(sdkmanagerPath, 0o755);
  await writeFile(
    path.join(cmdlineToolsDir, "source.properties"),
    `Pkg.Revision=${revision}\nPkg.Path=cmdline-tools;${revision}\n`,
    "utf8",
  );
};

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("detect-preinstalled-android-sdk", () => {
  it("prefers an executable sdkmanager that is already present", async () => {
    const sdkRoot = await makeTempDir("android-sdk-");
    await createPreinstalledSdk(sdkRoot, "12.0");

    const result = await resolvePreinstalledAndroidSdk({
      ANDROID_SDK_ROOT: sdkRoot,
      HOME: "/nonexistent-home",
    });

    expect(result.usePreinstalled).toBe(true);
    expect(result.androidSdkRoot).toBe(sdkRoot);
    expect(result.sdkmanagerPath).toBe(path.join(sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager"));
    expect(result.cmdlineToolsBin).toBe(path.join(sdkRoot, "cmdline-tools", "latest", "bin"));
    expect(result.platformToolsBin).toBe(path.join(sdkRoot, "platform-tools"));
    expect(result.emulatorBin).toBe(path.join(sdkRoot, "emulator"));
    expect(result.cmdlineToolsRevision).toBe("12.0");
  });

  it("returns a fallback result when no sdkmanager is available", async () => {
    const sdkRoot = await makeTempDir("android-sdk-empty-");

    const result = await resolvePreinstalledAndroidSdk({
      ANDROID_SDK_ROOT: sdkRoot,
      HOME: "/nonexistent-home",
    });

    expect(result.usePreinstalled).toBe(false);
    expect(result.androidSdkRoot).toBe("");
    expect(result.sdkmanagerPath).toBe("");
    expect(result.cmdlineToolsBin).toBe("");
  });

  it("deduplicates candidate roots while preserving lookup order", () => {
    const sdkRoot = path.join("/tmp", "android-sdk");
    const homeDir = path.join("/tmp", "home");

    expect(
      getAndroidSdkRootCandidates({
        ANDROID_SDK_ROOT: sdkRoot,
        ANDROID_HOME: `${sdkRoot}/../android-sdk`,
        HOME: homeDir,
      }),
    ).toEqual([sdkRoot, "/usr/local/lib/android/sdk", path.join(homeDir, "Android", "Sdk")]);
  });
});
