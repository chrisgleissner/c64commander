import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readWorkflow = (name: string) => readFileSync(path.resolve(process.cwd(), ".github/workflows", name), "utf8");

describe("telemetry release gate workflow rules", () => {
  it("hard-fails Android telemetry on monitor exit code 3 for stable tag and release branch flows", () => {
    const workflow = readWorkflow("android.yaml");
    expect(workflow).toContain('if [[ "$code" == "3" ]]; then');
    expect(workflow).toContain('if [[ "${GITHUB_REF_TYPE}" == "tag" && "${GITHUB_REF_NAME}" != *-rc* ]]; then');
    expect(workflow).toContain("telemetry gate failed: main process disappearance/restart detected on stable tag flow");
    expect(workflow).toContain("telemetry gate failed: main process disappearance/restart detected on release flow");
    expect(workflow).toContain(
      "telemetry gate warning: main process disappearance/restart detected (rc or non-release flow)",
    );
  });

  it("treats Android monitor exit code 137 as infra warning", () => {
    const workflow = readWorkflow("android.yaml");
    expect(workflow).toContain('if [[ "$code" == "137" ]]; then');
    expect(workflow).toContain(
      "telemetry gate warning: monitor exited with code 137 (likely infra resource kill); see ci-artifacts/telemetry/android/monitor-run.log",
    );
  });

  it("does not publish Android release artifacts for rc tags", () => {
    const workflow = readWorkflow("android.yaml");
    expect(workflow).toContain(
      "if: startsWith(github.ref, 'refs/tags/') && !contains(github.ref_name, '-rc')\n" +
        "    needs: [variant-selection, web-coverage-merge, android-tests, android-packaging]",
    );
    const stableTagReleaseCondition =
      "if: startsWith(github.ref, 'refs/tags/') && !contains(github.ref_name, '-rc') && env.HAS_KEYSTORE == 'true'";
    expect(workflow).toContain("- name: Build APK (release)");
    expect(workflow).toContain("- name: Upload AAB to Google Play (internal)");
    expect(
      workflow.match(new RegExp(stableTagReleaseCondition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length,
    ).toBeGreaterThanOrEqual(10);
  });

  it("hard-fails iOS telemetry on monitor exit code 3 for stable tag and release branch flows", () => {
    const workflow = readWorkflow("ios.yaml");
    expect(workflow).toContain('if [[ "$code" == "3" ]]; then');
    expect(workflow).toContain('if [[ "${GITHUB_REF_TYPE}" == "tag" && "${GITHUB_REF_NAME}" != *-rc* ]]; then');
    expect(workflow).toContain("telemetry gate failed: app process disappearance/restart detected on stable tag flow");
    expect(workflow).toContain("telemetry gate failed: app process disappearance/restart detected on release flow");
    expect(workflow).toContain(
      "telemetry gate warning: app process disappearance/restart detected (rc or non-release flow)",
    );
  });

  it("treats iOS monitor exit code 137 as infra warning", () => {
    const workflow = readWorkflow("ios.yaml");
    expect(workflow).toContain('if [[ "$code" == "137" ]]; then');
    expect(workflow).toContain(
      "telemetry gate warning: monitor exited with code 137 (likely infra resource kill); see artifacts/ios/_infra/telemetry/monitor-run.log",
    );
  });

  it("uploads iOS telemetry and diagnostics artifacts on failure", () => {
    const workflow = readWorkflow("ios.yaml");
    expect(workflow).toContain("- name: Upload iOS failure diagnostics");
    expect(workflow).toContain("if: failure()");
    expect(workflow).toContain("artifacts/ios/_infra/telemetry/events.log");
    expect(workflow).toContain("artifacts/ios/_infra/simulator/**");
    expect(workflow).toContain("artifacts/ios/_infra/xcodebuild/**");
  });

  it("passes the telemetry lifecycle directory into the iOS Maestro runner", () => {
    const workflow = readWorkflow("ios.yaml");
    expect(workflow).toContain('export TELEMETRY_FLOW_LIFECYCLE_DIR="artifacts/ios/_infra/telemetry"');
  });

  it("transitions lifecycle flags inside the per-flow iOS Maestro runner", () => {
    const script = readFileSync(path.resolve(process.cwd(), "scripts/ci/ios-maestro-run-flow.sh"), "utf8");
    expect(script).toContain('FLOW_LIFECYCLE_DIR="${TELEMETRY_FLOW_LIFECYCLE_DIR:-}"');
    expect(script).toContain("set_flow_lifecycle_state active");
    expect(script).toContain("set_flow_lifecycle_state complete");
    expect(script).toContain("set_flow_lifecycle_state reset");
  });

  it("hardens fuzz monitor lifecycle to always persist exit codes", () => {
    const workflow = readWorkflow("fuzz.yaml");
    const trapMatches = workflow.match(/trap 'write_code_file "\$status"' EXIT/g) ?? [];
    const fallbackMatches =
      workflow.match(/synthesized monitor\.exitcode=1 because wrapper exited before writing status/g) ?? [];
    expect(trapMatches.length).toBeGreaterThanOrEqual(2);
    expect(fallbackMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("hardens iOS monitor lifecycle to always persist exit codes", () => {
    const workflow = readWorkflow("ios.yaml");
    expect(workflow).toContain("trap 'write_code_file \"$status\"' EXIT");
    expect(workflow).toContain(
      "telemetry(ios): synthesized monitor.exitcode=1 because wrapper exited before writing status",
    );
  });

  it("hardens web monitor lifecycle to always persist exit codes", () => {
    const workflow = readWorkflow("web.yaml");
    expect(workflow).toContain("trap 'write_code_file \"$status\"' EXIT");
    expect(workflow).toContain(
      "telemetry(web): synthesized monitor.exitcode=1 because wrapper exited before writing status",
    );
  });
});
