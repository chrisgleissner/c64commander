import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoFile = (...parts: string[]) => path.resolve(process.cwd(), ...parts);

describe("run-maestro-gating required flows", () => {
  /**
   * The gate asserts that the ci-critical flows actually executed. It searched the Maestro
   * report for the flow name as a bare substring, and every required name has a longer
   * sibling: smoke-launch has smoke-launch-resume and smoke-launch-sequence, smoke-hvsc has
   * smoke-hvsc-lowram and smoke-hvsc-mounted. A report holding only a sibling satisfied the
   * search, so the gate could report that a required flow ran when it had not.
   */
  it("passes the shell harness that extracts the check from run-maestro-gating.sh", () => {
    const harness = repoFile("tests", "unit", "ci", "run_maestro_gating_required_flows.test.sh");
    const result = execFileSync("bash", [harness], { encoding: "utf8" });

    expect(result).toContain("Failed: 0");
    expect(result).toContain("Passed: 6");
    expect(result).toContain("ok - sibling flows do not satisfy the shorter name");
  });

  it("keeps the harness bound to the production script rather than to its own copy", () => {
    const harness = readFileSync(repoFile("tests", "unit", "ci", "run_maestro_gating_required_flows.test.sh"), "utf8");

    expect(harness).toContain('PRODUCTION_SCRIPT="$ROOT_DIR/scripts/run-maestro-gating.sh"');
    expect(harness).toContain('eval "$(extract_definition assert_required_flows_present)"');
    expect(harness).not.toMatch(/^\s*assert_required_flows_present\(\) \{/m);
  });

  it("keeps the production check anchored and still invoked by the gate", () => {
    const script = readFileSync(repoFile("scripts", "run-maestro-gating.sh"), "utf8");

    expect(script).toContain("assert_required_flows_present() {");
    expect(script).toContain('if ! assert_required_flows_present "$RAW_OUTPUT_DIR/maestro-report.xml"');
    expect(script).not.toMatch(/grep -q "\$flow"/);
  });
});
