import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoFile = (...parts: string[]) => path.resolve(process.cwd(), ...parts);

describe("run-maestro device preflight", () => {
  /**
   * tests/unit/ci/run_maestro_device_preflight.test.sh was not referenced by any npm script,
   * workflow or vitest file, so it never ran. It also declared its own copies of the preflight
   * functions, so it could not have detected a change to scripts/run-maestro.sh even when run.
   * This wrapper puts it in the unit test job, and the harness now extracts the production
   * definitions.
   */
  it("passes the shell harness that extracts the preflight functions from run-maestro.sh", () => {
    const harness = repoFile("tests", "unit", "ci", "run_maestro_device_preflight.test.sh");
    const result = execFileSync("bash", [harness], { encoding: "utf8" });

    expect(result).toContain("Failed: 0");
    expect(result).toMatch(/Passed: (?:[1-9]\d+|9)/);
  });

  it("keeps the harness bound to the production script rather than to its own copies", () => {
    const harness = readFileSync(repoFile("tests", "unit", "ci", "run_maestro_device_preflight.test.sh"), "utf8");

    expect(harness).toContain('PRODUCTION_SCRIPT="$ROOT_DIR/scripts/run-maestro.sh"');
    expect(harness).toContain('eval "$(extract_definition "$definition")"');
    expect(harness).toContain("for definition in get_current_focus_window is_keyguard_showing unlock_device");
    expect(harness).toContain("ensure_device_ready_for_automation select_long_timeout_ms");
    expect(harness).not.toMatch(/^\s*(?:ensure_device_ready_for_automation|select_long_timeout_ms)\(\) \{/m);
  });
});
