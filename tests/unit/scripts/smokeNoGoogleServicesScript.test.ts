import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve(process.cwd(), "scripts/smoke-no-google-services.sh");

describe("smoke-no-google-services.sh", () => {
  // The keyboard has to be gone before the walk for two reasons: it covers the tab bar
  // the walk taps, and the AOSP keyboard on this image asks for the contacts permission
  // the first time it opens, in a system dialog that sits above everything and swallows
  // every tap. Every other emulator job runs a google_apis image with Gboard, which asks
  // for nothing, so no other job hits either problem. The walk types nothing.
  //
  // Disabling the package, not only the input method: the framework keeps at least one
  // input method enabled and re-enables the default as soon as the last one is disabled,
  // so `ime disable` on its own leaves a working keyboard behind.
  it("disables the input method package before walking the app", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("adb shell ime list -s");
    expect(script).toContain('adb shell pm disable-user --user 0 "$ime_package"');
    expect(script.indexOf("adb shell ime list -s")).toBeLessThan(script.indexOf("maestro --no-ansi test"));
    expect(script.indexOf('adb shell pm disable-user --user 0 "$ime_package"')).toBeLessThan(
      script.indexOf("maestro --no-ansi test"),
    );
  });

  // This image defaults to the three-button navigation bar, which is drawn over the strip
  // of screen the app puts its own tab bar in, so a tap on a tab goes to the system rather
  // than the app. Every other emulator job runs a google_apis image, which defaults to
  // gesture navigation, so no other job hits it. Whether a real handset on three-button
  // navigation has the same problem is a separate open question; this only keeps the job
  // measuring whether the app runs without Google services.
  it("switches the emulator to gesture navigation before walking the app", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("adb shell cmd overlay enable-exclusive com.android.internal.systemui.navbar.gestural");
    expect(
      script.indexOf("adb shell cmd overlay enable-exclusive com.android.internal.systemui.navbar.gestural"),
    ).toBeLessThan(script.indexOf("maestro --no-ansi test"));
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
