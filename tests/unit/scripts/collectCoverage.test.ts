import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Stub expensive collection, but execute the real collector and its real threshold checker.
const collect = (lines: number, branches: number, overrides: Record<string, string> = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "collect-coverage-gate-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    for (const file of ["collect-coverage.sh", "check-coverage-threshold.mjs"]) {
      copyFileSync(path.resolve("scripts", file), path.join(root, "scripts", file));
    }
    writeFileSync(
      path.join(root, "fixture.info"),
      [
        "SF:src/fixture.ts",
        ...Array.from({ length: 100 }, (_, i) => `DA:${i + 1},${i < lines ? 1 : 0}`),
        ...Array.from({ length: 100 }, (_, i) => `BRDA:${i + 1},0,0,${i < branches ? 1 : 0}`),
        "end_of_record",
      ].join("\n"),
    );
    return spawnSync(
      "bash",
      [
        "-c",
        `
      npm() { return 0; }
      npx() { mkdir -p coverage/merged; cp fixture.info coverage/merged/lcov.info; }
      export -f npm npx
      bash scripts/collect-coverage.sh
    `,
      ],
      {
        cwd: root,
        env: { ...process.env, COVERAGE_MIN: "", COVERAGE_MIN_BRANCH: "", GITHUB_STEP_SUMMARY: "", ...overrides },
        encoding: "utf8",
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("merged coverage collection gate", () => {
  it("accepts 93 percent lines and 85 percent branches, matching the Vitest 4 CI gate", () => {
    const result = collect(93, 85);
    expect(result.status, result.stderr).toBe(0);
  });
  it("rejects merged line coverage below the CI minimum", () => {
    const result = collect(92, 90);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("92.00% < 93%");
  });
  it("rejects merged branch coverage below the CI minimum", () => {
    const result = collect(95, 84);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("84.00% < 85%");
  });
  it("honours stricter explicitly supplied thresholds", () => {
    const result = collect(94, 90, { COVERAGE_MIN: "95", COVERAGE_MIN_BRANCH: "90" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("94.00% < 95%");
  });
});
