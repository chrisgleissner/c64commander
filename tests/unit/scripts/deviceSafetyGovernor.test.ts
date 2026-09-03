/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const helperPath = path.resolve("scripts/lib/device-safety-governor.sh");
const buildPath = path.resolve("build");

function resolve(c64uTarget: string, buildsApk: string, runsPlaywright: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(
    "bash",
    ["-c", `source "${helperPath}"; resolve_device_safety_governor "${c64uTarget}" "${buildsApk}" "${runsPlaywright}"`],
    { encoding: "utf8", env: { ...process.env, VITE_DEVICE_SAFETY_GOVERNOR: "", ...env } },
  );
  expect(result.status).toBe(0);
  return result.stdout;
}

describe("resolve_device_safety_governor (HARD27-036)", () => {
  it("keeps the governor on for a build that targets the real machine", () => {
    expect(resolve("real", "false", "false")).toBe("1");
  });

  it("keeps the governor on for any build that produces an APK", () => {
    expect(resolve("mock", "true", "false")).toBe("1");
  });

  it("leaves the variable unset for a mock web build", () => {
    expect(resolve("mock", "false", "false")).toBe("");
  });

  it("leaves the variable unset when the same dist also feeds a Playwright run", () => {
    expect(resolve("real", "true", "true")).toBe("");
  });

  it("honours an explicit override in either direction", () => {
    expect(resolve("real", "true", "false", { VITE_DEVICE_SAFETY_GOVERNOR: "0" })).toBe("0");
    expect(resolve("mock", "false", "true", { VITE_DEVICE_SAFETY_GOVERNOR: "1" })).toBe("1");
  });

  it("is applied by the build script before it enables test probes", () => {
    const script = fs.readFileSync(buildPath, "utf8");
    const governorIndex = script.indexOf("resolve_device_safety_governor");
    const probeIndex = script.indexOf("export VITE_ENABLE_TEST_PROBES=1");

    expect(governorIndex).toBeGreaterThan(-1);
    expect(probeIndex).toBeGreaterThan(-1);
    expect(governorIndex).toBeLessThan(probeIndex);
    expect(script).toContain('source "$ROOT_DIR/scripts/lib/device-safety-governor.sh"');
  });
});
