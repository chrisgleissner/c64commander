import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readRepoFile = (...parts: string[]) => readFileSync(path.resolve(process.cwd(), ...parts), "utf8");

describe("iOS Maestro CI contracts", () => {
  it("runs shared iOS subflow probes in CI before grouped flows", () => {
    const workflow = readRepoFile(".github", "workflows", "ios.yaml");
    expect(workflow).toContain("- name: Validate shared iOS subflows");
    expect(workflow).toContain("bash scripts/ci/validate-ios-maestro-shared-subflows.sh");
    expect(workflow).toContain("if: matrix.group.name == 'group-1'");
  });

  it("does not swallow per-flow connectivity validation failures", () => {
    const workflow = readRepoFile(".github", "workflows", "ios.yaml");
    expect(workflow).toContain("connectivity_status=0");
    expect(workflow).toContain('if ! bash scripts/ci/validate-ios-connectivity.sh "artifacts/ios/${flow}"; then');
    expect(workflow).not.toContain('bash scripts/ci/validate-ios-connectivity.sh "artifacts/ios/${flow}" || true');
  });

  it("guarantees fallback JUnit and non-empty fallback debug payloads in the iOS runner", () => {
    const runner = readRepoFile("scripts", "ci", "ios-maestro-run-flow.sh");
    expect(runner).toContain("write_fallback_junit_report");
    expect(runner).toContain("write_fallback_debug_payload");
    expect(runner).toContain("Maestro still running:");
    expect(runner).toContain("IOS_MAESTRO_HEARTBEAT_SECONDS");
    expect(runner).not.toContain("wrote empty array");
    expect(runner).not.toContain("wrote empty stub");
  });

  it("keeps the fallback payload heredoc terminated before later shell functions", () => {
    const runner = readRepoFile("scripts", "ci", "ios-maestro-run-flow.sh");
    expect(runner).toContain("\nPY\n}\n\ncapture_accessibility_snapshot() {");
  });

  it("treats fallback debug payloads as diagnostic evidence instead of connectivity failures", () => {
    const validator = readRepoFile("scripts", "ci", "validate-ios-connectivity.sh");
    expect(validator).toContain("debug-endpoint-unavailable");
    expect(validator).toContain("network.json is runner fallback evidence");
    expect(validator).toContain("errorLog.json is runner fallback evidence");
  });
});
