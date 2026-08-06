import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve(process.cwd(), "scripts/smoke-no-google-services.sh");

describe("smoke-no-google-services.sh", () => {
  // The AOSP image ships the AOSP keyboard, which asks for the contacts permission the
  // first time it opens. That request is a system dialog: it sits above the app and
  // swallows every tap, so the walk fails on whatever step comes next. It happens here
  // and nowhere else because every other emulator job runs a google_apis image with
  // Gboard, which does not ask. The walk types nothing, so no keyboard is needed.
  it("turns the on-screen keyboard off before walking the app", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("adb shell ime list -s");
    expect(script).toContain('adb shell ime disable "$ime"');
    expect(script.indexOf("adb shell ime list -s")).toBeLessThan(script.indexOf("maestro --no-ansi test"));
  });

  // Every wait here has to be bounded, per AGENTS.md: an unbounded one hangs until the
  // runner kills the job, which reports as a timeout naming nothing.
  it("bounds the boot wait and the install", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("BOOT_TIMEOUT_SECS=");
    expect(script).toContain("boot_deadline=");
    expect(script).toContain("timeout 120 adb install -r -g");
  });

  // A Java uncaught exception is only one of the ways the app can die on this image.
  it("fails on native crashes and ANRs, not only on FATAL EXCEPTION", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("FATAL EXCEPTION");
    expect(script).toContain("Fatal signal [0-9]+ .*>>> $PKG <<<");
    expect(script).toContain("ANR in $PKG");
  });
});
