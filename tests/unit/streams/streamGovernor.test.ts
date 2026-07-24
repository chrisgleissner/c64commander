/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_GOVERNOR_CONFIG, StreamGovernor, type GovernorSignals } from "@/lib/streams/streamGovernor";

const C = DEFAULT_GOVERNOR_CONFIG;

/** Healthy pressure snapshot: full audio buffer, no underruns, latency/queue comfortable. */
const healthy = (over: Partial<GovernorSignals> = {}): GovernorSignals => ({
  audioBufferMs: C.audioHealthyMs + 20,
  audioUnderruns: 0,
  localLatencyP99Ms: 20,
  videoQueueAgeMs: 20,
  frameProcessingP95Ms: 5,
  ...over,
});

/** Feed `n` healthy ticks spaced `stepMs` apart, returning the final time. */
const soakHealthy = (gov: StreamGovernor, startMs: number, n: number, stepMs: number): number => {
  let t = startMs;
  for (let i = 0; i < n; i++) {
    t += stepMs;
    gov.update(healthy(), t);
  }
  return t;
};

describe("StreamGovernor — user modes → ceiling percent", () => {
  it("maps each requested mode to its maximum percent (rate ceiling)", () => {
    expect(new StreamGovernor("auto").state.ceilingPercent).toBe(100);
    expect(new StreamGovernor("100").state.ceilingPercent).toBe(100);
    expect(new StreamGovernor("50").state.ceilingPercent).toBe(50);
    expect(new StreamGovernor("25").state.ceilingPercent).toBe(25);
  });

  it("effective = min(ceiling, governor); a fresh governor is unpressured, and exposes a keep-fraction", () => {
    expect(new StreamGovernor("auto").state.effectivePercent).toBe(100);
    expect(new StreamGovernor("auto").state.effectiveFraction).toBe(1);
    expect(new StreamGovernor("50").state.effectivePercent).toBe(50);
    expect(new StreamGovernor("50").state.effectiveFraction).toBe(0.5);
    expect(new StreamGovernor("25").state.effectiveFraction).toBe(0.25);
  });
});

describe("StreamGovernor — continuous demote (one step per pressure signal)", () => {
  it("demotes by demoteStep on an audio underrun", () => {
    const gov = new StreamGovernor("auto");
    const s = gov.update(healthy({ audioUnderruns: 1 }), 1000);
    expect(s.effectivePercent).toBe(100 - C.demoteStep);
    expect(s.reason).toContain("underrun");
  });

  it("demotes on near-dry audio buffer, latency, queue age and frame-processing pressure", () => {
    for (const signal of [
      { audioBufferMs: C.audioCriticalMs },
      { localLatencyP99Ms: C.localLatencyBudgetMs * C.approachFraction },
      { videoQueueAgeMs: C.videoQueueAgeMaxMs * C.approachFraction },
      { frameProcessingP95Ms: C.frameProcessingBudgetMs },
    ]) {
      const gov = new StreamGovernor("auto");
      gov.update(healthy(), 900); // prime the audio buffer first (a real session warms up)
      expect(gov.update(healthy(signal), 1000).effectivePercent).toBe(100 - C.demoteStep);
    }
  });

  it("steps continuously down toward the floor and stops there", () => {
    const gov = new StreamGovernor("auto");
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) seen.push(gov.update(healthy({ audioUnderruns: 1 }), 1000 + i).effectivePercent);
    // 100 → 80 → 60 → 40 → 20 → 10 (floor), then holds at the floor.
    expect(seen).toEqual([80, 60, 40, 20, 10, 10, 10, 10]);
    expect(gov.state.effectivePercent).toBe(C.minPercent);
  });
});

describe("StreamGovernor — audio warmup + video-only (HIL-hardened)", () => {
  it("does not demote during startup while the audio buffer is priming from 0 (no false demote)", () => {
    const gov = new StreamGovernor("auto");
    // First ~1 s of a session: audio active but the WebAudio buffer hasn't filled yet (bufferedMs 0).
    let t = 0;
    for (let i = 0; i < 5; i++) {
      t += 250;
      gov.update(healthy({ audioBufferMs: 0, audioActive: true }), t);
    }
    // The zero buffer is warmup, not starvation → the governor holds full rate.
    expect(gov.state.effectivePercent).toBe(100);
    // Once the buffer primes healthy, normal adaptation resumes: a subsequent underrun demotes.
    gov.update(healthy({ audioActive: true }), t + 250); // primes
    expect(gov.update(healthy({ audioUnderruns: 1, audioActive: true }), t + 500).effectivePercent).toBe(80);
  });

  it("a video-only session (audioActive:false) ignores the audio buffer and holds full rate", () => {
    const gov = new StreamGovernor("auto");
    let t = 0;
    for (let i = 0; i < 20; i++) {
      t += 250;
      // No audio player → bufferedMs is permanently 0, underruns 0. Must NOT peg to the floor.
      gov.update({ audioBufferMs: 0, audioUnderruns: 0, audioActive: false }, t);
    }
    expect(gov.state.effectivePercent).toBe(100);
  });

  it("a video-only session still demotes and recovers on a video-side latency signal", () => {
    const gov = new StreamGovernor("auto");
    const demoted = gov.update(
      { audioBufferMs: 0, audioUnderruns: 0, audioActive: false, localLatencyP99Ms: C.localLatencyBudgetMs },
      100,
    );
    expect(demoted.effectivePercent).toBe(80); // video latency still bites
    // Latency clears; recovery works even though the audio buffer is 0 (audio inactive isn't a gate).
    let t = 100;
    for (let i = 0; i < 40; i++) {
      t += 250;
      gov.update({ audioBufferMs: 0, audioUnderruns: 0, audioActive: false, localLatencyP99Ms: 5 }, t);
    }
    expect(gov.state.effectivePercent).toBe(100);
  });
});

describe("StreamGovernor — promote slow (hysteresis + cooldown + anti-oscillation)", () => {
  it("does not promote until headroom has held for the stable window", () => {
    const gov = new StreamGovernor("auto");
    gov.update(healthy({ audioUnderruns: 1 }), 1000); // → 80
    soakHealthy(gov, 1000, 5, (C.promoteStableMs - 100) / 5); // just under the window
    expect(gov.state.effectivePercent).toBe(80);
  });

  it("promotes gradually in single promoteStep increments back to full rate", () => {
    const gov = new StreamGovernor("auto");
    gov.update(healthy({ audioUnderruns: 1 }), 100); // → 80
    gov.update(healthy({ audioUnderruns: 1 }), 200); // → 60
    expect(gov.state.effectivePercent).toBe(60);

    // Long sustained-headroom soak: record each distinct effective level as it climbs from 60.
    const levels: number[] = [];
    let prev = gov.state.effectivePercent; // 60
    let t = 200;
    for (let i = 0; i < 60; i++) {
      t += 500;
      gov.update(healthy(), t);
      const p = gov.state.effectivePercent;
      if (p !== prev) {
        levels.push(p);
        prev = p;
      }
    }
    // Gradual, single-step (never a jump), monotonic up to full rate.
    expect(levels).toEqual([70, 80, 90, 100]);
    expect(gov.state.effectivePercent).toBe(100);
  });

  it("does not promote a second step without a fresh stable window (one step per window)", () => {
    const gov = new StreamGovernor("auto");
    gov.update(healthy({ audioUnderruns: 1 }), 100); // → 80 (breaks the streak)
    // Exactly one window's worth of healthy ticks after the streak starts → exactly one promote.
    const start = 100;
    let promoted = 0;
    let prev = gov.state.effectivePercent;
    let t = start;
    while (t - start <= C.promoteStableMs + 200) {
      t += 250;
      gov.update(healthy(), t);
      if (gov.state.effectivePercent !== prev) {
        promoted += 1;
        prev = gov.state.effectivePercent;
      }
    }
    expect(promoted).toBe(1);
    expect(gov.state.effectivePercent).toBe(90);
  });

  it("demotion outpaces promotion (asymmetric steps)", () => {
    expect(C.demoteStep).toBeGreaterThan(C.promoteStep);
  });
});

describe("StreamGovernor — manual mode is a maximum, not a floor (§11.2)", () => {
  it("100% can be overridden below full rate to protect audio, then recovers to the ceiling", () => {
    const gov = new StreamGovernor("100");
    expect(gov.state.effectivePercent).toBe(100);
    const s = gov.update(healthy({ audioUnderruns: 1 }), 1000);
    expect(s.effectivePercent).toBe(80);
    expect(s.overridden).toBe(true);
    soakHealthy(gov, 1000, 30, 500);
    expect(gov.state.effectivePercent).toBe(100);
    expect(gov.state.overridden).toBe(false);
  });

  it("25% clamps at a quarter with full headroom and is not marked overridden", () => {
    const gov = new StreamGovernor("25");
    soakHealthy(gov, 0, 20, C.promoteStableMs / 4);
    expect(gov.state.effectivePercent).toBe(25);
    expect(gov.state.overridden).toBe(false);
  });

  it("50% under pressure overrides below the cap immediately, and recovery stops at the 50% ceiling", () => {
    const gov = new StreamGovernor("50");
    const s = gov.update(healthy({ audioUnderruns: 1 }), 100); // base min(100,50)=50 → 30
    expect(s.effectivePercent).toBe(30);
    expect(s.overridden).toBe(true);
    soakHealthy(gov, 100, 40, 500);
    expect(gov.state.effectivePercent).toBe(50); // back to the manual ceiling, not above
    expect(gov.state.overridden).toBe(false);
  });
});

describe("StreamGovernor — transitions log", () => {
  it("records transitions with requested + from/to percent + reason, bounded in length", () => {
    const gov = new StreamGovernor("auto", { ...C, maxTransitions: 4 });
    for (let i = 0; i < 10; i++) gov.update(healthy({ audioUnderruns: 1 }), 100 + i);
    const log = gov.getTransitions();
    expect(log.length).toBeLessThanOrEqual(4);
    expect(log.every((t) => typeof t.reason === "string" && t.reason.length > 0)).toBe(true);
    expect(log.every((t) => t.toPercent < t.fromPercent)).toBe(true); // all demotes here
  });

  it("records a user transition when a mode change alters the effective rate", () => {
    const gov = new StreamGovernor("auto");
    gov.setRequested("25", 500);
    const user = gov.getTransitions().filter((t) => t.kind === "user");
    expect(user).toHaveLength(1);
    expect(user[0].toPercent).toBe(25);
    expect(user[0].requested).toBe("25");
  });

  it("reset() returns to an unpressured governor (mode preserved)", () => {
    const gov = new StreamGovernor("auto");
    gov.update(healthy({ audioUnderruns: 1 }), 100);
    gov.update(healthy({ audioUnderruns: 1 }), 200);
    gov.reset();
    expect(gov.state.effectivePercent).toBe(100);
    expect(gov.getTransitions()).toHaveLength(0);
  });
});

describe("StreamGovernor — no oscillation under steady borderline load", () => {
  it("holds a stable level when audio hovers just above healthy (no flapping)", () => {
    const gov = new StreamGovernor("auto");
    gov.update(healthy({ audioUnderruns: 1 }), 100); // → 80
    let flips = 0;
    let prev = gov.state.effectivePercent;
    let t = 100;
    for (let i = 0; i < 200; i++) {
      t += 50;
      gov.update(healthy({ audioBufferMs: C.audioHealthyMs + 1 }), t);
      if (gov.state.effectivePercent !== prev) {
        flips += 1;
        prev = gov.state.effectivePercent;
      }
    }
    // Over 10 s it slowly promotes 80 → 100 in single steps, never oscillating back down.
    expect(flips).toBeLessThanOrEqual(3);
    expect(gov.state.effectivePercent).toBe(100);
  });
});
