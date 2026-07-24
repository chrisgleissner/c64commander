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

describe("StreamGovernor — user modes → ceiling divisor", () => {
  it("maps each requested mode to its minimum divisor (rate ceiling)", () => {
    expect(new StreamGovernor("auto").state.ceilingDivisor).toBe(1);
    expect(new StreamGovernor("100").state.ceilingDivisor).toBe(1);
    expect(new StreamGovernor("50").state.ceilingDivisor).toBe(2);
    expect(new StreamGovernor("25").state.ceilingDivisor).toBe(4);
  });

  it("effective = max(ceiling, governor); a fresh governor is unpressured (level 1)", () => {
    expect(new StreamGovernor("auto").state.effectiveDivisor).toBe(1);
    expect(new StreamGovernor("50").state.effectiveDivisor).toBe(2);
    expect(new StreamGovernor("25").state.effectiveDivisor).toBe(4);
  });
});

describe("StreamGovernor — demote fast (one level per pressure signal)", () => {
  it("demotes immediately on an audio underrun", () => {
    const gov = new StreamGovernor("auto");
    const s = gov.update(healthy({ audioUnderruns: 1 }), 1000);
    expect(s.governorDivisor).toBe(2);
    expect(s.effectiveDivisor).toBe(2);
    expect(s.reason).toContain("underrun");
  });

  it("demotes when the audio buffer is at/below critical", () => {
    const gov = new StreamGovernor("auto");
    const s = gov.update(healthy({ audioBufferMs: C.audioCriticalMs }), 1000);
    expect(s.governorDivisor).toBe(2);
    expect(s.reason).toContain("audio buffer");
  });

  it("demotes when local latency approaches the budget", () => {
    const gov = new StreamGovernor("auto");
    const near = C.localLatencyBudgetMs * C.approachFraction;
    const s = gov.update(healthy({ localLatencyP99Ms: near }), 1000);
    expect(s.governorDivisor).toBe(2);
    expect(s.reason).toContain("latency");
  });

  it("demotes when the video queue age approaches its cap", () => {
    const gov = new StreamGovernor("auto");
    const near = C.videoQueueAgeMaxMs * C.approachFraction;
    const s = gov.update(healthy({ videoQueueAgeMs: near }), 1000);
    expect(s.governorDivisor).toBe(2);
    expect(s.reason).toContain("queue age");
  });

  it("demotes when frame-processing p95 exceeds its budget", () => {
    const gov = new StreamGovernor("auto");
    const s = gov.update(healthy({ frameProcessingP95Ms: C.frameProcessingBudgetMs }), 1000);
    expect(s.governorDivisor).toBe(2);
    expect(s.reason).toContain("frame proc");
  });

  it("steps one level at a time and stops at the worst level (4)", () => {
    const gov = new StreamGovernor("auto");
    expect(gov.update(healthy({ audioUnderruns: 1 }), 1000).governorDivisor).toBe(2);
    expect(gov.update(healthy({ audioUnderruns: 1 }), 1100).governorDivisor).toBe(4);
    // Already at the worst level: stays at 4, no further change.
    expect(gov.update(healthy({ audioUnderruns: 1 }), 1200).governorDivisor).toBe(4);
  });
});

describe("StreamGovernor — promote slow (hysteresis + cooldown + anti-oscillation)", () => {
  it("does not promote until headroom has held for the stable window", () => {
    const gov = new StreamGovernor("auto");
    gov.update(healthy({ audioUnderruns: 1 }), 1000); // → level 2
    // Just under the stable window: no promotion yet.
    const t = soakHealthy(gov, 1000, 5, (C.promoteStableMs - 100) / 5);
    expect(gov.state.governorDivisor).toBe(2);
    void t;
  });

  it("promotes exactly one level after sustained headroom, then requires a fresh window", () => {
    const gov = new StreamGovernor("auto");
    gov.update(healthy({ audioUnderruns: 1 }), 100); // → 2
    gov.update(healthy({ audioUnderruns: 1 }), 200); // → 4
    expect(gov.state.governorDivisor).toBe(4);

    // One sustained window (10 ticks × 500 ms = 4500 ms) yields EXACTLY one promotion 4 → 2:
    // after promoting, the window + cooldown reset, and the soak's remainder is too short to promote
    // again. This is the "one level at a time" guarantee.
    let t = soakHealthy(gov, 200, 10, 500);
    expect(gov.state.governorDivisor).toBe(2);

    // A second, equally-long window is needed for the next single step 2 → 1.
    t = soakHealthy(gov, t, 10, 500);
    expect(gov.state.governorDivisor).toBe(1);
  });

  it("a single mid-soak underrun resets the headroom streak (no premature promote)", () => {
    const gov = new StreamGovernor("auto");
    gov.update(healthy({ audioUnderruns: 1 }), 100); // → 2
    // Nearly a full window of headroom …
    let t = soakHealthy(gov, 100, 4, (C.promoteStableMs - 200) / 4);
    // … then one underrun breaks the streak (and would re-demote, but we're capped by nothing here).
    t += 50;
    gov.update(healthy({ audioUnderruns: 1 }), t); // breaks streak, demotes toward 4
    expect(gov.state.governorDivisor).toBe(4);
    // A short further healthy burst (< window) must NOT promote.
    t = soakHealthy(gov, t, 3, (C.promoteStableMs - 500) / 3);
    expect(gov.state.governorDivisor).toBe(4);
  });
});

describe("StreamGovernor — manual mode is a maximum, not a floor (§11.2)", () => {
  it("100% can be overridden below full rate to protect audio, then recovers to the ceiling", () => {
    const gov = new StreamGovernor("100");
    expect(gov.state.effectiveDivisor).toBe(1);
    const s = gov.update(healthy({ audioUnderruns: 1 }), 1000);
    expect(s.effectiveDivisor).toBe(2);
    expect(s.overridden).toBe(true);

    soakHealthy(gov, 1000, 12, (C.promoteStableMs + 200) / 6);
    expect(gov.state.effectiveDivisor).toBe(1);
    expect(gov.state.overridden).toBe(false);
  });

  it("25% never presents more than a quarter even with full headroom (ceiling clamps)", () => {
    const gov = new StreamGovernor("25");
    soakHealthy(gov, 0, 20, C.promoteStableMs / 4);
    expect(gov.state.governorDivisor).toBe(1);
    expect(gov.state.effectiveDivisor).toBe(4); // clamped by the 25% ceiling
    expect(gov.state.overridden).toBe(false);
  });

  it("50% under pressure overrides to 25%-equivalent, and recovery stops at the 50% ceiling", () => {
    const gov = new StreamGovernor("50");
    gov.update(healthy({ audioUnderruns: 1 }), 100); // governor 1→2, effective max(2,2)=2
    gov.update(healthy({ audioUnderruns: 1 }), 200); // governor 2→4, effective max(2,4)=4 (override)
    expect(gov.state.effectiveDivisor).toBe(4);
    expect(gov.state.overridden).toBe(true);
    soakHealthy(gov, 200, 30, (C.promoteStableMs + 200) / 6);
    expect(gov.state.effectiveDivisor).toBe(2); // back to the manual ceiling, not below
    expect(gov.state.overridden).toBe(false);
  });
});

describe("StreamGovernor — transitions log", () => {
  it("records demote/promote/user transitions with requested + reason, bounded in length", () => {
    const gov = new StreamGovernor("auto", { ...C, maxTransitions: 4 });
    for (let i = 0; i < 10; i++) gov.update(healthy({ audioUnderruns: 1 }), 100 + i);
    const log = gov.getTransitions();
    expect(log.length).toBeLessThanOrEqual(4);
    expect(log.every((t) => typeof t.reason === "string" && t.reason.length > 0)).toBe(true);
  });

  it("records a user transition when a mode change alters the effective rate", () => {
    const gov = new StreamGovernor("auto");
    gov.setRequested("25", 500);
    const user = gov.getTransitions().filter((t) => t.kind === "user");
    expect(user).toHaveLength(1);
    expect(user[0].toDivisor).toBe(4);
    expect(user[0].requested).toBe("25");
  });

  it("reset() returns to an unpressured auto-equivalent governor level", () => {
    const gov = new StreamGovernor("auto");
    gov.update(healthy({ audioUnderruns: 1 }), 100);
    gov.update(healthy({ audioUnderruns: 1 }), 200);
    gov.reset();
    expect(gov.state.governorDivisor).toBe(1);
    expect(gov.getTransitions()).toHaveLength(0);
  });
});

describe("StreamGovernor — no oscillation under steady borderline load", () => {
  it("holds a stable level when audio hovers just above healthy (no flapping)", () => {
    const gov = new StreamGovernor("auto");
    gov.update(healthy({ audioUnderruns: 1 }), 100); // → 2
    let flips = 0;
    let prev = gov.state.effectiveDivisor;
    let t = 100;
    for (let i = 0; i < 200; i++) {
      t += 50;
      // Just above healthy, never an underrun: must not demote, and promotes at most slowly.
      gov.update(healthy({ audioBufferMs: C.audioHealthyMs + 1 }), t);
      if (gov.state.effectiveDivisor !== prev) {
        flips += 1;
        prev = gov.state.effectiveDivisor;
      }
    }
    // Over 200 ticks it should promote 2→1 at most a couple of times, never oscillate back down.
    expect(flips).toBeLessThanOrEqual(2);
    expect(gov.state.effectiveDivisor).toBe(1);
  });
});
