import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LAUNCH_SEQUENCE_TIMINGS,
  getLaunchSequenceTotalMs,
  markStartupLaunchSequenceComplete,
  resetStartupLaunchSequenceStateForTests,
  resolveStartupLaunchSequenceTimings,
  runLaunchSequence,
  shouldShowStartupLaunchSequence,
} from "@/lib/startup/launchSequence";

describe("launchSequence", () => {
  beforeEach(() => {
    resetStartupLaunchSequenceStateForTests();
  });

  it("emits the cold-start launch phases in order with the expected timings", () => {
    vi.useFakeTimers();

    const phases: string[] = [];
    runLaunchSequence({
      onPhaseChange: (phase) => {
        phases.push(phase);
      },
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      cancel: (handle) => clearTimeout(handle),
    });

    expect(phases).toEqual(["fade-in"]);

    vi.advanceTimersByTime(DEFAULT_LAUNCH_SEQUENCE_TIMINGS.fadeInMs);
    expect(phases).toEqual(["fade-in", "hold"]);

    vi.advanceTimersByTime(DEFAULT_LAUNCH_SEQUENCE_TIMINGS.holdMs);
    expect(phases).toEqual(["fade-in", "hold", "fade-out"]);

    vi.advanceTimersByTime(DEFAULT_LAUNCH_SEQUENCE_TIMINGS.fadeOutMs);
    expect(phases).toEqual(["fade-in", "hold", "fade-out", "app-ready"]);

    vi.useRealTimers();
  });

  it("cancels pending phase transitions when the launch sequence is torn down", () => {
    vi.useFakeTimers();

    const phases: string[] = [];
    const stop = runLaunchSequence({
      onPhaseChange: (phase) => {
        phases.push(phase);
      },
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      cancel: (handle) => clearTimeout(handle),
    });

    stop();
    vi.advanceTimersByTime(getLaunchSequenceTotalMs());

    expect(phases).toEqual(["fade-in"]);

    vi.useRealTimers();
  });

  it("shows the launch sequence only once per runtime", () => {
    expect(shouldShowStartupLaunchSequence()).toBe(true);

    markStartupLaunchSequenceComplete();

    expect(shouldShowStartupLaunchSequence()).toBe(false);
  });

  it("prefers a window timing override when one is present", () => {
    const originalWindow = globalThis.window;
    const timingOverride = {
      fadeInMs: 900,
      holdMs: 1900,
      fadeOutMs: 700,
    };

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        __c64uLaunchSequenceTimings: timingOverride,
      },
    });

    expect(resolveStartupLaunchSequenceTimings()).toEqual(timingOverride);

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("keeps the launch overlay fades as pure opacity transitions", () => {
    const stylesheet = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");

    expect(stylesheet).toContain("@keyframes app-launch-fade-in");
    expect(stylesheet).toContain('.app-launch-shell[data-launch-phase="fade-in"],');
    expect(stylesheet).toContain('.app-launch-shell[data-launch-phase="fade-out"] {');
    expect(stylesheet).toContain(
      "animation: app-launch-fade-in var(--app-launch-fade-in-ms, 250ms) ease-out forwards;",
    );

    expect(stylesheet).toContain("@keyframes startup-launch-fade-in");
    expect(stylesheet).toContain("from {\n    opacity: 0;\n  }");
    expect(stylesheet).toContain("to {\n    opacity: 1;\n  }");
    expect(stylesheet).toContain('.startup-launch-sequence[data-phase="fade-in"] {');
    expect(stylesheet).toContain(
      "animation: startup-launch-fade-in var(--startup-launch-fade-in-ms, 300ms) ease-out forwards;",
    );

    expect(stylesheet).toContain("@keyframes startup-launch-fade-out");
    expect(stylesheet).toContain("from {\n    opacity: 1;\n  }");
    expect(stylesheet).toContain("to {\n    opacity: 0;\n  }");
    expect(stylesheet).toContain('.startup-launch-sequence[data-phase="fade-out"] {');
    expect(stylesheet).toContain(
      "animation: startup-launch-fade-out var(--startup-launch-fade-out-ms, 250ms) ease-in forwards;",
    );
    expect(stylesheet).toContain(".startup-launch-sequence__halo {");
    expect(stylesheet).toContain("  inset: 0;");
    expect(stylesheet).toContain("  font-family: Arial, ui-sans-serif, system-ui, sans-serif;");
    expect(stylesheet).not.toContain("  inset: -18%;");
    expect(stylesheet).not.toContain("startup-launch-backdrop-fade-out");
  });

  it("keeps the Android launch theme aligned with the generated icon background color", () => {
    const stylesXml = fs.readFileSync(
      path.resolve(process.cwd(), "android/app/src/main/res/values/styles.xml"),
      "utf8",
    );

    expect(stylesXml).toContain('<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>');
    expect(stylesXml).toContain('<item name="windowSplashScreenBackground">@color/ic_launcher_background</item>');
    expect(stylesXml).toContain('<item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>');
  });
});
