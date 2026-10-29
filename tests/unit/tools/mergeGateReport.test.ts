/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { describeError, gateReport, writeGateReport } from "../../../tools/hil/merge_gate.mjs";

const gateScript = path.resolve(process.cwd(), "tools/hil/merge_gate.mjs");
const tempDirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "merge-gate-report-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const runGate = (args: string[]) => {
  const report = path.join(tempDir(), "nested", "gate.json");
  const run = spawnSync(process.execPath, [gateScript, ...args, "--json", report], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return { run, report };
};

describe("the gate's --json report", () => {
  it("is written when the run refuses a volume above the ceiling", () => {
    const { run, report } = runGate(["--volume", "11"]);

    expect(run.status).toBe(2);
    expect(existsSync(report)).toBe(true);
    const written = JSON.parse(readFileSync(report, "utf8"));
    expect(written.exitCode).toBe(2);
    expect(written.message).toContain("refusing to run at volume 11");
    expect(written.results).toEqual([]);
  });

  it("is written when --only names a stage that does not exist", () => {
    const { run, report } = runGate(["--only", "no-such-stage"]);

    expect(run.status).toBe(2);
    const written = JSON.parse(readFileSync(report, "utf8"));
    expect(written.message).toContain("--only names no such stage: no-such-stage");
  });

  it("carries the stage results, skip reasons and exit code of an aborted run", async () => {
    const dir = tempDir();
    const file = path.join(dir, "aborted.json");
    const results = [
      { name: "preflight", phone: "pixel", status: "fail", detail: "fetch failed: caused by connect ECONNREFUSED" },
      { name: "input", phone: "pixel", status: "skipped", detail: "preflight failed on the pixel" },
    ];

    await writeGateReport(
      file,
      dir,
      gateReport({
        host: "c64u",
        plan: null,
        results,
        audibleSeconds: 0,
        exitCode: 2,
        message: "preflight failed on the pixel",
      }),
    );

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      host: "c64u",
      plan: null,
      results,
      audibleSeconds: 0,
      exitCode: 2,
      message: "preflight failed on the pixel",
    });
  });

  it("writes nothing when no --json file was requested", async () => {
    const dir = tempDir();

    await writeGateReport(
      "",
      dir,
      gateReport({ host: "c64u", plan: null, results: [], audibleSeconds: 0, exitCode: 0 }),
    );

    expect(existsSync(path.join(dir, "gate.json"))).toBe(false);
  });
});

describe("describeError", () => {
  it("names the cause behind fetch's generic failure and its error code", () => {
    const cause = Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    const failure = new TypeError("fetch failed", { cause });

    expect(describeError(failure)).toBe("fetch failed: caused by Connect Timeout Error (UND_ERR_CONNECT_TIMEOUT)");
  });

  it("stops on a cause that refers back to its error", () => {
    const failure = new Error("loop");
    failure.cause = failure;

    expect(describeError(failure)).toBe("loop");
  });

  it("describes a thrown non-error value", () => {
    expect(describeError("plain text")).toBe("plain text");
  });
});
