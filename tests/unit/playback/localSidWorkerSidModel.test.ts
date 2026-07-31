/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";

/**
 * The fallback SID chip must stay a fallback.
 *
 * libsidplayfp reads the model out of each tune's own header and consults the configured
 * `sidModel` only where the header says `UNKNOWN` or `ANY` — unless `forceSidModel` is set, which
 * makes the configured model override every declaration, including the per-chip models of a 2SID
 * or 3SID file. That rule was read out of the upstream source (`src/player.cpp`'s `sidCreate` and
 * `getSidModel`), and the fake engine below implements it, so these tests fail if the worker ever
 * starts forcing the model, stops sending it, or sends it at a point the engine cannot accept.
 */

type TuneSidModel = "UNKNOWN" | "MOS6581" | "MOS8580" | "ANY";

/** What the tune under test declares, per chip. Set by each case before `open`. */
let declaredModels: TuneSidModel[] = ["UNKNOWN"];
/** Ordered log of the engine calls the worker made, so ordering is assertable. */
let calls: string[] = [];

class FakeSidAudioEngine {
  /** libsidplayfp's own SidConfig defaults, which is what an unconfigured engine has. */
  private config: { sidModel: "MOS6581" | "MOS8580"; forceSidModel: boolean } = {
    sidModel: "MOS8580",
    forceSidModel: false,
  };
  private loaded = false;

  constructor(_options: { sampleRate?: number; stereo?: boolean }) {
    calls.push("construct");
  }
  async setSystemROMs(_kernal: Uint8Array | null, _basic: Uint8Array | null, _chargen: Uint8Array | null) {
    calls.push("setSystemROMs");
    await Promise.resolve();
  }
  async loadSidBuffer(_data: Uint8Array, _songIndex?: number): Promise<void> {
    calls.push("loadSidBuffer");
    this.loaded = true;
    await Promise.resolve();
  }
  /**
   * The vendored engine builds its player context during the first load, and every config
   * accessor goes through `requireContext()` — so reaching either before a tune is loaded throws.
   */
  private requireLoaded(): void {
    if (!this.loaded) throw new Error("SID player not initialized");
  }
  getEmulationConfig(): { sidModel: string } {
    this.requireLoaded();
    calls.push("getEmulationConfig");
    return { ...this.config };
  }
  async setEmulationConfig(config: { sidModel?: "MOS6581" | "MOS8580"; forceSidModel?: boolean }): Promise<void> {
    this.requireLoaded();
    calls.push("setEmulationConfig");
    this.config = { ...this.config, ...config };
    // The real engine reloads the open tune here so the change takes effect from its start. Logged
    // because it is the cost the worker's "the engine already agrees" check exists to avoid.
    calls.push("reload");
    await Promise.resolve();
  }
  getSampleRate(): number {
    return 48000;
  }
  getChannels(): number {
    return 2;
  }
  /**
   * The effective model of each chip, resolved exactly as libsidplayfp does it: the tune's own
   * declaration wins unless it is `UNKNOWN`/`ANY`, or unless the model has been forced.
   */
  getTuneInfo(): Record<string, unknown> {
    return {
      sidModels: declaredModels.map((declared) =>
        this.config.forceSidModel || declared === "UNKNOWN" || declared === "ANY" ? this.config.sidModel : declared,
      ),
    };
  }
  async renderSeconds(seconds: number): Promise<Int16Array> {
    return new Int16Array(Math.round(seconds * 100) * 2);
  }
  async seekSeconds(seconds: number): Promise<number> {
    return seconds;
  }
  dispose(): void {}
}

vi.mock("/wasm/libsidplayfp/dist/index.js", () => ({ SidAudioEngine: FakeSidAudioEngine }), { virtual: true });

interface FakeScope {
  postMessage: (message: LocalSidWorkerToMain, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<LocalSidMainToWorker>) => void) | null;
  __runsInWorker?: boolean;
}

let scope: FakeScope;
let posted: LocalSidWorkerToMain[];
const originalSelf = globalThis.self;

const send = (message: LocalSidMainToWorker) => {
  scope.onmessage?.({ data: message } as MessageEvent<LocalSidMainToWorker>);
};

/** Macrotasks, not microtasks: the worker resolves its engine through a dynamic `import()`. */
const drain = async (ticks = 12) => {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeAll(async () => {
  posted = [];
  scope = {
    postMessage: (message) => posted.push(message),
    onmessage: null,
  };
  Object.defineProperty(globalThis, "self", { value: scope, configurable: true, writable: true });
  await import("@/lib/playback/localSid.worker");
});

afterAll(() => {
  Object.defineProperty(globalThis, "self", { value: originalSelf, configurable: true, writable: true });
});

beforeEach(async () => {
  await drain();
  declaredModels = ["UNKNOWN"];
  calls = [];
  posted.length = 0;
});

const FAKE_ROMS = () => ({ kernal: new Uint8Array(8192).buffer, basic: new Uint8Array(8192).buffer });

const PSID_BYTES = () => new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer;

const openTune = async (sidModel?: "MOS6581" | "MOS8580", id = 1) => {
  send({ type: "load" } as LocalSidMainToWorker);
  send({
    type: "open",
    id,
    sidBytes: PSID_BYTES(),
    songIndex: 0,
    sampleRate: 48000,
    roms: FAKE_ROMS(),
    sidModel,
  } as LocalSidMainToWorker);
  await drain();
  const opened = posted.find((m) => m.type === "opened") as Extract<LocalSidWorkerToMain, { type: "opened" }>;
  return opened;
};

/** The per-chip models the fake engine reports as actually in effect. */
const effectiveModels = (opened: Extract<LocalSidWorkerToMain, { type: "opened" }>) =>
  (opened.tuneInfo as { sidModels?: string[] } | null)?.sidModels;

describe("localSid.worker fallback SID model", () => {
  it("plays a tune that names no chip on the requested one", async () => {
    declaredModels = ["UNKNOWN"];
    const opened = await openTune("MOS6581");
    expect(effectiveModels(opened)).toEqual(["MOS6581"]);
  });

  it("leaves a tune that names its own chip alone, whatever the fallback says", async () => {
    // Both directions, because only one of them makes the worker actually reconfigure the engine:
    // asking for the model the engine already assumes is skipped, so a forced model would slip
    // through a test that used that direction alone.
    declaredModels = ["MOS6581"];
    expect(effectiveModels(await openTune("MOS8580"))).toEqual(["MOS6581"]);

    posted.length = 0;
    calls = [];
    declaredModels = ["MOS8580"];
    expect(effectiveModels(await openTune("MOS6581", 2))).toEqual(["MOS8580"]);
  });

  it("keeps each chip of a multi-SID tune on the model it declares, filling in only the unknown one", async () => {
    declaredModels = ["MOS6581", "ANY", "MOS8580"];
    const opened = await openTune("MOS6581");
    expect(effectiveModels(opened)).toEqual(["MOS6581", "MOS6581", "MOS8580"]);
  });

  it("configures the model only after the tune is loaded, which is the only order the engine accepts", async () => {
    const opened = await openTune("MOS6581");
    expect(opened).toBeDefined();
    expect(posted.some((m) => m.type === "error")).toBe(false);
    expect(calls.indexOf("setEmulationConfig")).toBeGreaterThan(calls.indexOf("loadSidBuffer"));
  });

  it("does not reload the tune when the engine already uses the requested chip", async () => {
    // MOS8580 is what an unconfigured libsidplayfp assumes, so asking for it should cost nothing.
    await openTune("MOS8580");
    expect(calls).toContain("getEmulationConfig");
    expect(calls).not.toContain("setEmulationConfig");
    expect(calls).not.toContain("reload");
  });

  it("reloads exactly once when the chip differs", async () => {
    await openTune("MOS6581");
    expect(calls.filter((call) => call === "reload")).toHaveLength(1);
  });

  it("renders a pre-render on the same chip as playback", async () => {
    declaredModels = ["UNKNOWN"];
    send({ type: "load" } as LocalSidMainToWorker);
    send({
      type: "prerender",
      id: 7,
      sidBytes: PSID_BYTES(),
      songIndex: 0,
      sampleRate: 48000,
      seconds: 0.1,
      roms: FAKE_ROMS(),
      sidModel: "MOS6581",
    } as LocalSidMainToWorker);
    await drain();
    expect(posted.some((m) => m.type === "error")).toBe(false);
    expect(posted.some((m) => m.type === "prerendered")).toBe(true);
    expect(calls.indexOf("setEmulationConfig")).toBeGreaterThan(calls.indexOf("loadSidBuffer"));
  });

  it("still opens a tune when no fallback chip is supplied", async () => {
    declaredModels = ["UNKNOWN"];
    const opened = await openTune(undefined);
    expect(opened).toBeDefined();
    expect(calls).not.toContain("setEmulationConfig");
    expect(effectiveModels(opened)).toEqual(["MOS8580"]);
  });
});
