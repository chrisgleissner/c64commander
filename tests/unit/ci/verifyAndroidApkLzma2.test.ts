import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
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

  it("passes the shell harness covering both the apkanalyzer and DEX-scan branches", () => {
    const harness = repoFile("tests", "unit", "ci", "verify_android_apk_lzma2.test.sh");
    const result = execFileSync("bash", [harness], { encoding: "utf8" });

    expect(result).toContain("Failed: 0");
    expect(result).toMatch(/Passed: (?:[1-9]\d+|9)/);
  });
});
