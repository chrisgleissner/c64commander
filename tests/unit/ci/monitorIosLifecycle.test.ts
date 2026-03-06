import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const monitorScript = readFileSync(path.resolve(process.cwd(), "ci/telemetry/ios/monitor_ios.sh"), "utf8");

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
    expect(monitorScript).toContain('if [[ -f "$FLOW_ACTIVE_FLAG" && ! -f "$FLOW_COMPLETE_FLAG" ]]; then');
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
    expect(monitorScript).toContain('main_disappeared_during_flow" == "1"');
    expect(monitorScript).toContain("app process disappeared during active flow");
    expect(monitorScript).not.toContain("app process disappeared unexpectedly");
  });

  it("includes main_disappeared_during_flow in metadata.json", () => {
    expect(monitorScript).toContain('"main_disappeared_during_flow": ${main_disappeared_during_flow}');
  });

  it("preserves main_disappeared field in metadata.json for backwards compatibility", () => {
    expect(monitorScript).toContain('"main_disappeared": ${main_disappeared}');
  });

  it("passes shell lifecycle harness (flag-based state transitions)", () => {
    const harnessPath = path.resolve(process.cwd(), "tests/unit/ci/monitor_ios_lifecycle.test.sh");
    const result = execSync(`bash "${harnessPath}"`, { encoding: "utf8" });
    expect(result).toContain("passed, 0 failed");
  });
});
