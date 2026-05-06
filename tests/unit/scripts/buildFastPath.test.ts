import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const helperPath = path.resolve("scripts/lib/build-fast-path.sh");

const tempDirs: string[] = [];

function makeRepoFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "build-fast-path-"));
  tempDirs.push(repoRoot);

  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "patches"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "c64scope", "node_modules"), { recursive: true });

  fs.writeFileSync(path.join(repoRoot, "package.json"), '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(repoRoot, "package-lock.json"), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(repoRoot, "node_modules", ".package-lock.json"), '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(repoRoot, "patches", "fixture.patch"), "patch\n");
  fs.writeFileSync(path.join(repoRoot, "c64scope", "package.json"), '{"name":"scope-fixture"}\n');
  fs.writeFileSync(path.join(repoRoot, "c64scope", "package-lock.json"), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(repoRoot, "c64scope", "node_modules", ".package-lock.json"), '{"name":"scope-fixture"}\n');

  const snapshotTime = new Date("2026-05-06T12:00:10Z");
  const staleTime = new Date("2026-05-06T12:00:00Z");

  const staleFiles = [
    path.join(repoRoot, "package.json"),
    path.join(repoRoot, "package-lock.json"),
    path.join(repoRoot, "patches", "fixture.patch"),
    path.join(repoRoot, "c64scope", "package.json"),
    path.join(repoRoot, "c64scope", "package-lock.json"),
  ];

  for (const filePath of staleFiles) {
    fs.utimesSync(filePath, staleTime, staleTime);
  }

  const snapshotFiles = [
    path.join(repoRoot, "node_modules", ".package-lock.json"),
    path.join(repoRoot, "c64scope", "node_modules", ".package-lock.json"),
  ];

  for (const filePath of snapshotFiles) {
    fs.utimesSync(filePath, snapshotTime, snapshotTime);
  }

  return repoRoot;
}

function runBash(script: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", ["-lc", script], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dirPath = tempDirs.pop();
    if (dirPath) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }
});

describe("build fast path helper", () => {
  it("returns the debug saved device bootstrap json in the requested order", () => {
    const rawBootstrap = execFileSync(
      "bash",
      ["-lc", `source ${JSON.stringify(helperPath)}\nbuild_debug_saved_devices_bootstrap_json`],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
      },
    );

    expect(JSON.parse(rawBootstrap)).toEqual([
      {
        id: "debug-u64",
        name: "u64",
        nameSource: "USER",
        host: "192.168.1.13",
        httpPort: 80,
        ftpPort: 21,
        telnetPort: 23,
        hasPassword: false,
      },
      {
        id: "debug-c64u",
        name: "c64u",
        nameSource: "USER",
        host: "192.168.1.167",
        httpPort: 80,
        ftpPort: 21,
        telnetPort: 23,
        hasPassword: false,
      },
    ]);
  });

  it("disables npm install and formatting for the fast local apk install path when dependencies are current", () => {
    const repoRoot = makeRepoFixture();
    const script = [
      `source ${JSON.stringify(helperPath)}`,
      "RUN_INSTALL=true",
      "RUN_FORMAT=true",
      "FAST_LOCAL_APK_INSTALL=false",
      `apply_fast_local_apk_install_defaults ${JSON.stringify(repoRoot)} false`,
      'printf "%s\\n" "$FAST_LOCAL_APK_INSTALL,$RUN_INSTALL,$RUN_FORMAT"',
    ].join("\n");

    const result = runBash(script);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("true,false,false");
  });

  it("keeps npm install enabled when the dependency snapshot is stale", () => {
    const repoRoot = makeRepoFixture();
    const staleLockfilePath = path.join(repoRoot, "package-lock.json");
    const newerTime = new Date("2026-05-06T12:00:20Z");
    fs.utimesSync(staleLockfilePath, newerTime, newerTime);

    const result = runBash(
      [
        `source ${JSON.stringify(helperPath)}`,
        "RUN_INSTALL=true",
        "RUN_FORMAT=true",
        "FAST_LOCAL_APK_INSTALL=false",
        `apply_fast_local_apk_install_defaults ${JSON.stringify(repoRoot)} false`,
        'printf "%s\\n" "$FAST_LOCAL_APK_INSTALL,$RUN_INSTALL,$RUN_FORMAT"',
      ].join("\n"),
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("true,true,false");
  });

  it("selects the sole attached physical device without requiring a device id", () => {
    const adbOutput = ["List of devices attached", "9B081FFAZ001WX\tdevice", ""].join("\n");
    const selectedDeviceId = execFileSync(
      "bash",
      ["-lc", [`source ${JSON.stringify(helperPath)}`, 'resolve_adb_device_id "" "$ADB_TEST_OUTPUT"'].join("\n")],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
        env: { ...process.env, ADB_TEST_OUTPUT: adbOutput },
      },
    ).trim();

    expect(selectedDeviceId).toBe("9B081FFAZ001WX");
  });

  it("fails fast when multiple physical devices are connected without a unique preferred device", () => {
    const adbOutput = ["List of devices attached", "ABC123\tdevice", "XYZ789\tdevice", ""].join("\n");
    const result = runBash(
      [`source ${JSON.stringify(helperPath)}`, 'resolve_adb_device_id "" "$ADB_TEST_OUTPUT"'].join("\n"),
      { ADB_TEST_OUTPUT: adbOutput },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Multiple adb devices found");
  });
});
