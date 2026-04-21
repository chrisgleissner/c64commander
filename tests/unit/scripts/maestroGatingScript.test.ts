import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve(process.cwd(), "scripts/run-maestro-gating.sh");

describe("run-maestro-gating.sh", () => {
  it("cleans stale Maestro processes and adb forwards before running flows", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("cleanup_maestro_processes()");
    expect(script).toContain("cleanup_maestro_processes\n");
    expect(script).toContain('adb -s "$DEVICE_ID" forward --remove-all >/dev/null 2>&1 || true');
    expect(script).toContain("ensure_device_ready_for_automation()");
    expect(script).toContain("trap cleanup_device_state EXIT");
    expect(script).toContain('ensure_device_ready_for_automation "$DEVICE_ID"');
  });
});
