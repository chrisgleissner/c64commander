import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoFile = (...parts: string[]) => path.resolve(process.cwd(), ...parts);

describe("iOS Maestro accessibility snapshot", () => {
  /**
   * capture_accessibility_snapshot was gated on debug_server_reachable, which answers "is this a
   * DEBUG build whose in-app HTTP server bound port 39877", not "is the app running". In run
   * 33840657287 all three snapshots recorded "skipped-app-not-running" while the failure
   * screenshot taken moments later showed the app rendered on screen, so a text-anchor failure had
   * no view hierarchy to diagnose it with. `maestro hierarchy` needs no such server.
   */
  it("passes the shell harness that extracts capture_accessibility_snapshot from the runner", () => {
    const harness = repoFile("tests", "unit", "ci", "ios_maestro_accessibility_snapshot.test.sh");
    const run = spawnSync("bash", [harness], { encoding: "utf8" });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

    expect(run.status, `harness exited ${run.status}:\n${output}`).toBe(0);
    expect(output).toContain("Failed: 0");
    expect(output).toContain("Passed: 4");
  });

  it("keeps the harness bound to the production runner rather than to its own copy", () => {
    const harness = readFileSync(repoFile("tests", "unit", "ci", "ios_maestro_accessibility_snapshot.test.sh"), "utf8");

    expect(harness).toContain('PRODUCTION_SCRIPT="$ROOT_DIR/scripts/ci/ios-maestro-run-flow.sh"');
    expect(harness).toContain('eval "$(extract_definition capture_accessibility_snapshot)"');
    expect(harness).not.toMatch(/^\s*capture_accessibility_snapshot\(\) \{/m);
  });

  /**
   * The failure path is the one that has to dump unconditionally: a flow that has already failed
   * is worth the ~16s a `maestro hierarchy` timeout costs when the app really is gone. The pre-flow
   * and post-flow snapshots keep the gate, which is what stops a normal run paying that cost twice.
   */
  it("dumps the hierarchy on the failure path without asking the in-app debug server", () => {
    const runner = readFileSync(repoFile("scripts", "ci", "ios-maestro-run-flow.sh"), "utf8");

    expect(runner).toContain('capture_accessibility_snapshot "$flow_dir" "failure" "no"');
    expect(runner).toContain('capture_accessibility_snapshot "$flow_dir" "pre-flow"');
    expect(runner).toContain('capture_accessibility_snapshot "$flow_dir" "post-flow"');
    expect(runner).toContain('if [[ "$require_debug_server" == "yes" ]] && ! debug_server_reachable; then');
    // The old status string claimed the app was not running, which the failure screenshot disproved.
    expect(runner).not.toContain("skipped-app-not-running");
  });
});
