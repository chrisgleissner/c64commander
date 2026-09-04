import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoFile = (...parts: string[]) => path.resolve(process.cwd(), ...parts);

describe("iOS Maestro flow exit status", () => {
  /**
   * scripts/ci/ios-maestro-run-flow.sh reported success for every failing Maestro flow:
   * run_maestro_and_capture ended with a `cp` and a `log`, so the exit status of the python
   * block that runs Maestro and summarises its JUnit report was discarded. In run
   * 33825210983 all three ci-critical-ios flows failed their assertions while the
   * "iOS | Maestro" job and the whole run reported success.
   */
  it("passes the shell harness that extracts run_maestro_and_capture from the runner", () => {
    const harness = repoFile("tests", "unit", "ci", "ios_maestro_flow_exit_status.test.sh");
    const result = execFileSync("bash", [harness], { encoding: "utf8" });

    expect(result).toContain("Failed: 0");
    expect(result).toContain("Passed: 3");
  });

  it("keeps the harness bound to the production runner rather than to its own copy", () => {
    const harness = readFileSync(repoFile("tests", "unit", "ci", "ios_maestro_flow_exit_status.test.sh"), "utf8");

    expect(harness).toContain('PRODUCTION_SCRIPT="$ROOT_DIR/scripts/ci/ios-maestro-run-flow.sh"');
    expect(harness).toContain('eval "$(extract_definition run_maestro_and_capture)"');
    expect(harness).not.toMatch(/^\s*run_maestro_and_capture\(\) \{/m);
  });

  /**
   * The status has to be captured on the python invocation itself. A `return $?` added after
   * the trailing `cp` would read the status of the `cp`, and the caller runs this function on
   * the left of `&&`, which suppresses `set -e` inside it.
   */
  it("captures the Maestro status on the python invocation and returns it", () => {
    const runner = readFileSync(repoFile("scripts", "ci", "ios-maestro-run-flow.sh"), "utf8");

    expect(runner).toContain("<<'PY' || maestro_status=$?");
    expect(runner).toContain("  return $maestro_status");
  });
});
