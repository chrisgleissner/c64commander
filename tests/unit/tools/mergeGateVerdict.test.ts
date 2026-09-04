/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The hardware merge gate's exit code, which is the only part of it most callers read.
 *
 * `AGENTS.md` makes this gate mandatory before a merge, and the run is driven by hand with an
 * `--only` list. Before this test existed, `--only av_clarity` — the same stage with an underscore
 * — selected no stage at all, ran nothing, printed an empty table and exited 0. Every caller that
 * checks `$?` recorded a passing merge gate for a run that measured nothing.
 */

import { describe, expect, it } from "vitest";

import { STAGE_NAMES, gateVerdict, unknownOnlyStages } from "../../../tools/hil/merge_gate.mjs";

const pass = (name: string) => ({ name, status: "pass", detail: "" });

describe("unknownOnlyStages", () => {
  it("accepts every name the gate actually registers", () => {
    expect(unknownOnlyStages(STAGE_NAMES)).toEqual([]);
  });

  it("names a stage misspelt with an underscore", () => {
    expect(unknownOnlyStages(["av_clarity"])).toEqual(["av_clarity"]);
  });

  it("names only the unknown entries of a mixed list", () => {
    expect(unknownOnlyStages(["av-clarity", "bogus", "wire"])).toEqual(["bogus"]);
  });

  it("passes an empty list, which means every stage", () => {
    expect(unknownOnlyStages([])).toEqual([]);
  });
});

describe("gateVerdict", () => {
  it("passes a run in which stages passed", () => {
    expect(gateVerdict([pass("preflight"), pass("wire")])).toMatchObject({ exitCode: 0 });
  });

  it("fails a run with a failed stage, naming it", () => {
    const verdict = gateVerdict([pass("preflight"), { name: "wire", status: "fail", detail: "no packets" }]);
    expect(verdict.exitCode).toBe(1);
    expect(verdict.message).toContain("wire");
  });

  // The regression. An empty result set is not a clean run; it is a run that never happened.
  it("refuses to pass a run in which no stage ran", () => {
    const verdict = gateVerdict([]);
    expect(verdict.exitCode).toBe(2);
    expect(verdict.message).toContain("verifies nothing");
  });

  it("refuses to pass a run whose every stage was skipped", () => {
    const verdict = gateVerdict([{ name: "av-clarity", status: "skipped", detail: "audible stage" }]);
    expect(verdict.exitCode).toBe(2);
    expect(verdict.message).toContain("verifies nothing");
  });

  it("refuses to pass a run whose every stage is still pending", () => {
    expect(gateVerdict([{ name: "wire", status: "pending", detail: "not written yet" }]).exitCode).toBe(2);
  });

  // A quiet check is a real run: it executes the silent stages and skips the audible ones.
  it("passes a run that skipped its audible stages but passed its silent ones", () => {
    const verdict = gateVerdict([pass("preflight"), { name: "av-clarity", status: "skipped", detail: "audible" }]);
    expect(verdict.exitCode).toBe(0);
  });

  // A failure outranks the emptiness check: the caller needs the failing stage's name.
  it("reports a failure rather than emptiness when a run both failed and passed nothing", () => {
    const verdict = gateVerdict([{ name: "preflight", status: "fail", detail: "no ADB device" }]);
    expect(verdict).toMatchObject({ exitCode: 1 });
    expect(verdict.message).toContain("preflight");
  });
});
