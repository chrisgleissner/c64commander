import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const monitorScript = readFileSync(path.resolve(process.cwd(), "ci/telemetry/ios/monitor_ios.sh"), "utf8");
const lifecycleScript = readFileSync(path.resolve(process.cwd(), "ci/telemetry/ios/lifecycle.sh"), "utf8");

describe("iOS monitor lifecycle state machine", () => {
  it("defines FLOW_ACTIVE_FLAG and FLOW_COMPLETE_FLAG from lifecycle dir", () => {
    expect(monitorScript).toContain('FLOW_LIFECYCLE_DIR="${TELEMETRY_FLOW_LIFECYCLE_DIR:-$OUT_DIR}"');
    expect(monitorScript).toContain('FLOW_ACTIVE_FLAG="$FLOW_LIFECYCLE_DIR/flow-active.flag"');
    expect(monitorScript).toContain('FLOW_COMPLETE_FLAG="$FLOW_LIFECYCLE_DIR/flow-complete.flag"');
  });

  it("ensures FLOW_LIFECYCLE_DIR is created", () => {
    expect(monitorScript).toContain('mkdir -p "$FLOW_LIFECYCLE_DIR"');
  });

  it("tracks main_disappeared_during_flow separately from main_disappeared", () => {
    expect(monitorScript).toContain("main_disappeared_during_flow=0");
    expect(monitorScript).toContain("main_disappeared_during_flow=1");
  });

  it("checks flow-active.flag and flow-complete.flag on process disappearance", () => {
    expect(lifecycleScript).toContain('if [[ -f "$flow_active_flag" && ! -f "$flow_complete_flag" ]]; then');
    expect(monitorScript).toContain('classify_disappearance "$FLOW_ACTIVE_FLAG" "$FLOW_COMPLETE_FLAG"');
  });

  /**
   * A disappearance is held for the grace window first, because Maestro stops and launches the app
   * at the start of every flow and SpringBoard reports that as a host termination.
   */
  it("holds a mid-flow disappearance until the relaunch grace window passes", () => {
    expect(monitorScript).toContain('RELAUNCH_GRACE_SEC="${TELEMETRY_IOS_RELAUNCH_GRACE_SEC:-15}"');
    expect(monitorScript).toContain('log_event "process_disappeared_during_flow_pending"');
    expect(monitorScript).toContain('log_event "process_relaunched_during_flow"');
    expect(monitorScript).toContain(
      '! disappearance_is_pending "$((sample_ts - pending_during_flow_ts))" "$RELAUNCH_GRACE_SEC"',
    );
    expect(lifecycleScript).toContain("(( elapsed_sec <= grace_sec ))");
  });

  it("commits a held disappearance that never came back when the monitor stops", () => {
    expect(monitorScript).toContain("crash during active flow (never returned)");
  });

  it("emits process_disappeared_during_flow event for crash during active flow", () => {
    expect(monitorScript).toContain('log_event "process_disappeared_during_flow"');
    expect(monitorScript).toContain("crash during active flow");
  });

  it("emits process_disappeared_after_flow event for expected teardown", () => {
    expect(monitorScript).toContain('log_event "process_disappeared_after_flow"');
    expect(monitorScript).toContain("expected teardown");
  });

  it("exits 3 only when main_disappeared_during_flow is set", () => {
    expect(lifecycleScript).toContain('"$main_disappeared_during_flow" == "1"');
    expect(monitorScript).toContain(
      'decide_exit_code "$EXPECT_MAIN_PID" "$main_seen_once" "$main_disappeared_during_flow"',
    );
    expect(monitorScript).toContain("app process disappeared during active flow");
    expect(monitorScript).not.toContain("app process disappeared unexpectedly");
  });

  it("includes main_disappeared_during_flow in metadata.json", () => {
    expect(monitorScript).toContain('"main_disappeared_during_flow": ${main_disappeared_during_flow}');
  });

  it("preserves main_disappeared field in metadata.json for backwards compatibility", () => {
    expect(monitorScript).toContain('"main_disappeared": ${main_disappeared}');
  });

  /**
   * The shell harness exercises the simctl-unreliable downgrade, but nothing bound that branch
   * to the monitor, so the harness could have kept asserting a distinction the script no longer
   * made.
   */
  it("separates the simctl-unreliable disappearance with its own exit code", () => {
    expect(monitorScript).toContain("main_disappeared_during_flow_simctl_unreliable=0");
    expect(monitorScript).toContain("main_disappeared_during_flow_simctl_unreliable=1");
    expect(lifecycleScript).toContain('if [[ "$main_disappeared_during_flow_simctl_unreliable" == "1" ]]; then');
    expect(lifecycleScript).toContain("return 4");
    expect(monitorScript).toContain("simctl unavailable at detection; reliability reduced");
  });

  it("passes shell lifecycle harness (flag-based state transitions)", () => {
    const harnessPath = path.resolve(process.cwd(), "tests/unit/ci/monitor_ios_lifecycle.test.sh");
    const result = execSync(`bash "${harnessPath}"`, { encoding: "utf8" });
    expect(result).toContain("passed, 0 failed");
  });
});
