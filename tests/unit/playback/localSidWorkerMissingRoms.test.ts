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
 * A tune must still open when the C64 ROM images are missing.
 *
 * This is the defect S3-LOCAL-ENGINE-SILENT-ON-STEADY-TONE-SIDS turned out to be. The worker used
 * to answer `romRequired: true` for ANY tune when no images were supplied, while
 * `romFallbackDecision` had already routed the tune here and told the listener it would play. The
 * result was silence with nothing logged, and it is easy to reach: BASIC is read from $A000, which
 * is RAM whenever it is banked out, so a capture taken while a program is running stores the KERNAL
 * alone and leaves the set incomplete for good.
 *
 * libsidplayfp does not need the images for a PSID -- it synthesizes a minimal KERNAL. Measured
 * through this exact call sequence on libsidplayfp-wasm 1.0.1, five PSIDs rendered at -11.6 to
 * -17.8 dBFS peak with nulls, indistinguishable in level from the same tunes with real images.
 */

let calls: string[] = [];
let romArgs: Array<{ kernal: boolean; basic: boolean }> = [];

class FakeSidAudioEngine {
  private loaded = false;
  constructor(_options: { sampleRate?: number; stereo?: boolean }) {
    calls.push("construct");
  }
  async setSystemROMs(kernal: Uint8Array | null, basic: Uint8Array | null, _chargen: Uint8Array | null) {
    calls.push("setSystemROMs");
    romArgs.push({ kernal: kernal !== null, basic: basic !== null });
    await Promise.resolve();
  }
  async loadSidBuffer(_data: Uint8Array, _songIndex?: number): Promise<void> {
    calls.push("loadSidBuffer");
    this.loaded = true;
    await Promise.resolve();
  }
  getEmulationConfig(): { sidModel: string } {
    if (!this.loaded) throw new Error("SID player not initialized");
    return { sidModel: "MOS6581" };
  }
  async setEmulationConfig(): Promise<void> {
    if (!this.loaded) throw new Error("SID player not initialized");
    await Promise.resolve();
  }
  getSampleRate(): number {
    return 48000;
  }
  getChannels(): number {
    return 2;
  }
  getTuneInfo(): Record<string, unknown> {
    return { title: "fake" };
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

const drain = async (ticks = 12) => {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Wait for an answer rather than for a fixed number of turns; opening is asynchronous. */
const drainUntil = async (done: () => boolean, ticks = 400) => {
  for (let i = 0; i < ticks && !done(); i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
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
  calls = [];
  romArgs = [];
  posted.length = 0;
});

const PSID_BYTES = () => new Uint8Array([0x50, 0x53, 0x49, 0x44, 0, 2, 0, 0x7c]).buffer;

const open = async (roms: { kernal: ArrayBuffer; basic: ArrayBuffer } | null, id: number) => {
  send({ type: "load" } as LocalSidMainToWorker);
  send({
    type: "open",
    id,
    sidBytes: PSID_BYTES(),
    songIndex: 0,
    sampleRate: 48000,
    roms,
  } as unknown as LocalSidMainToWorker);
  await drainUntil(() => posted.some((m) => m.type === "opened"));
  return posted.find((m) => m.type === "opened") as Extract<LocalSidWorkerToMain, { type: "opened" }>;
};

describe("the local SID worker with no C64 ROM images", () => {
  it("opens the tune instead of refusing it", async () => {
    const opened = await open(null, 1);

    expect(opened).toBeDefined();
    // The whole defect in one assertion: this used to be true, and the tune played nothing.
    expect(opened.romRequired).toBe(false);
    expect(calls).toContain("loadSidBuffer");
    expect(opened.sampleRate).toBe(48000);
  });

  it("passes nulls to the engine rather than empty images", async () => {
    await open(null, 2);

    // libsidplayfp synthesizes a minimal KERNAL for a null; an empty Uint8Array is a real image
    // that happens to be blank, which is not the same request.
    expect(romArgs).toEqual([{ kernal: false, basic: false }]);
  });

  it("still passes the images through when they are there", async () => {
    await open({ kernal: new Uint8Array(8192).buffer, basic: new Uint8Array(8192).buffer }, 3);

    expect(romArgs).toEqual([{ kernal: true, basic: true }]);
  });
});
