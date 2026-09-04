import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoFile = (...parts: string[]) => path.resolve(process.cwd(), ...parts);

describe("verify-android-apk-lzma2 gate", () => {
  /**
   * `if ! find_with_apkanalyzer ...; then if [[ $? -eq 2 ]]` read the status of the negated
   * condition, which is always 0 inside the branch, so the "apkanalyzer is not installed"
   * fallback was unreachable. On any host without the Android cmdline-tools the gate reported
   * that an APK carrying both runtime classes was missing them.
   */
  it("reads the apkanalyzer exit status from the call rather than from the negated condition", () => {
    const script = readFileSync(repoFile("scripts", "verify-android-apk-lzma2.sh"), "utf8");

    expect(script).toContain('find_with_apkanalyzer "$apk_path" "$dotted" || status=$?');
    expect(script).toContain('if [[ "$status" -ne 2 ]]; then');
    expect(script).not.toContain("if ! find_with_apkanalyzer");
  });

  /**
   * Both class searches pipe a producer into `grep -q`, which exits on its first match and
   * leaves the producer to die of SIGPIPE. Under `set -o pipefail` the dead producer decided
   * the pipeline status, so a class present near the start of a large DEX, or of apkanalyzer's
   * package listing, was reported as absent. The subshell keeps grep's own verdict.
   */
  it("reads each class search from grep rather than from a producer killed by SIGPIPE", () => {
    const script = readFileSync(repoFile("scripts", "verify-android-apk-lzma2.sh"), "utf8");

    expect(script).toContain(
      'if ( set +o pipefail; unzip -p "$apk_path" "$dex_entry" | strings | grep -q "$needle" ); then',
    );
    expect(script).toContain(
      'if ( set +o pipefail; "$apkanalyzer" dex packages "$apk_path" | grep -q "$needle" ); then',
    );
  });

  it("passes the shell harness covering both the apkanalyzer and DEX-scan branches", () => {
    const harness = repoFile("tests", "unit", "ci", "verify_android_apk_lzma2.test.sh");
    // spawnSync, not execFileSync: a non-zero harness exit used to throw "Command failed: bash
    // <path>" with the harness output discarded, which named neither the failing case nor its
    // exit status. The per-case PASS/FAIL lines are the whole point of running it.
    const run = spawnSync("bash", [harness], { encoding: "utf8" });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

    expect(run.status, `harness exited ${run.status}:\n${output}`).toBe(0);
    expect(output).toContain("Failed: 0");
    expect(output).toMatch(/Passed: (?:[1-9]\d+|9)/);
  });
});
