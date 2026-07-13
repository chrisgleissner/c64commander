import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const monitorScript = readFileSync(path.resolve(process.cwd(), "ci/telemetry/android/monitor_android.sh"), "utf8");

describe("Android monitor lifecycle state machine", () => {
  it("tracks main_restart_count separately from main_disappeared", () => {
    expect(monitorScript).toContain("main_restart_count=0");
  });

  it("downgrades a recovered disappearance instead of leaving the gate tripped", () => {
    expect(monitorScript).toContain('log_event "process_recovered"');
    expect(monitorScript).toContain('"$main_disappeared" == "1"');
    expect(monitorScript).toContain("main_disappeared=0");
    expect(monitorScript).toContain("main_restart_count=$(( main_restart_count + 1 ))");
  });

  it("still records a genuine disappearance before it is known to have recovered", () => {
    expect(monitorScript).toContain('log_event "process_disappeared"');
    expect(monitorScript).toContain("main_disappeared=1");
  });

  it("includes main_restart_count in metadata.json", () => {
    expect(monitorScript).toContain('"main_restart_count": ${main_restart_count}');
  });

  it("preserves main_disappeared field in metadata.json for backwards compatibility", () => {
    expect(monitorScript).toContain('"main_disappeared": ${main_disappeared}');
  });

  it("exits 3 only when main_disappeared is still set at monitor shutdown", () => {
    expect(monitorScript).toContain('"$main_disappeared" == "1"');
    expect(monitorScript).toContain("main process disappeared unexpectedly");
  });

  it("passes shell lifecycle harness (recover-vs-terminal state transitions)", () => {
    const harnessPath = path.resolve(process.cwd(), "tests/unit/ci/monitor_android_lifecycle.test.sh");
    const result = execSync(`bash "${harnessPath}"`, { encoding: "utf8" });
    expect(result).toContain("passed, 0 failed");
  });
});
