/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({
  kernal: new Uint8Array(8192).fill(1),
  basic: new Uint8Array(8192).fill(2),
  chargen: new Uint8Array(4096).fill(3),
}));
const current = vi.hoisted(() => ({ roms: undefined as Record<string, Uint8Array> | undefined }));
vi.mock("@/lib/roms/romStore", () => ({ loadStoredRoms: () => current.roms ?? stored, hasCompleteRomSet: () => true }));

import { LocalSidEngine, type LocalSidWorkerLike } from "@/lib/playback/localSidEngine";
import {
  toRendererRoms,
  type LocalSidMainToWorker,
  type LocalSidWorkerToMain,
} from "@/lib/playback/localSidWorkerProtocol";

class RecordingWorker implements LocalSidWorkerLike {
  readonly sent: Array<{ message: LocalSidMainToWorker; transfer: Transferable[] }> = [];
  private handler: ((event: MessageEvent<LocalSidWorkerToMain>) => void) | null = null;
  postMessage(message: LocalSidMainToWorker, transfer: Transferable[] = []): void {
    this.sent.push({ message, transfer });
  }
  addEventListener(type: "message", handler: (event: MessageEvent<LocalSidWorkerToMain>) => void): void;
  addEventListener(type: "error", handler: (event: { message?: string }) => void): void;
  addEventListener(type: "messageerror", handler: () => void): void;
  addEventListener(type: string, handler: (...args: never[]) => void): void {
    if (type === "message") this.handler = handler as typeof this.handler;
  }
  terminate(): void {}
  emit(message: LocalSidWorkerToMain): void {
    this.handler?.({ data: message } as MessageEvent<LocalSidWorkerToMain>);
  }
}

const romsOf = (worker: RecordingWorker, type: "open" | "prerender") => {
  const entry = worker.sent.find((sent) => sent.message.type === type)!;
  return { roms: (entry.message as { roms?: Record<string, ArrayBuffer> }).roms, transfer: entry.transfer };
};

const bytesOf = (buffer: ArrayBuffer | undefined) => (buffer ? [buffer.byteLength, new Uint8Array(buffer)[0]] : null);

describe("the C64 ROMs a tune is opened with", () => {
  it("sends KERNAL, BASIC and the character ROM as transferred copies of the stored images", async () => {
    const worker = new RecordingWorker();
    const engine = new LocalSidEngine({ workerFactory: () => worker });
    void engine.play(new ArrayBuffer(64), 0, {});
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const open = worker.sent.find((entry) => entry.message.type === "open")!;
    const roms = (open.message as Extract<LocalSidMainToWorker, { type: "open" }>).roms!;
    expect([bytesOf(roms.kernal), bytesOf(roms.basic), bytesOf(roms.chargen)]).toEqual([
      [8192, 1],
      [8192, 2],
      [4096, 3],
    ]);
    expect(open.transfer).toEqual(expect.arrayContaining([roms.kernal, roms.basic, roms.chargen]));
    expect(roms.chargen).not.toBe(stored.chargen.buffer);
  });

  it("sends no ROMs at all without both KERNAL and BASIC, whatever else is stored", () => {
    expect(toRendererRoms({ kernal: stored.kernal, chargen: stored.chargen })).toBeUndefined();
    expect(toRendererRoms({ basic: stored.basic })).toBeUndefined();
    expect(Object.keys(toRendererRoms({ kernal: stored.kernal, basic: stored.basic })!)).toEqual(["kernal", "basic"]);
  });

  afterEach(() => {
    current.roms = undefined;
  });

  it("opens a tune without ROM buffers in the transfer list when KERNAL and BASIC are not both stored", async () => {
    current.roms = { chargen: stored.chargen };
    const worker = new RecordingWorker();
    const engine = new LocalSidEngine({ workerFactory: () => worker });
    void engine.play(new ArrayBuffer(64), 0, {});
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { roms, transfer } = romsOf(worker, "open");
    expect(roms).toBeUndefined();
    expect(transfer).toHaveLength(1);
  });

  it("pre-renders with transferred copies of the stored ROMs", () => {
    const worker = new RecordingWorker();
    const engine = new LocalSidEngine({ workerFactory: () => worker });
    const tune = new ArrayBuffer(64);

    engine.prerender("tune#0", tune, 0, 30);

    const { roms, transfer } = romsOf(worker, "prerender");
    expect([bytesOf(roms!.kernal), bytesOf(roms!.basic), bytesOf(roms!.chargen)]).toEqual([
      [8192, 1],
      [8192, 2],
      [4096, 3],
    ]);
    expect(transfer).toEqual([tune, roms!.kernal, roms!.basic, roms!.chargen]);
  });

  it("pre-renders without ROMs rather than refusing when KERNAL and BASIC are not both stored", () => {
    current.roms = { kernal: stored.kernal };
    const worker = new RecordingWorker();
    const engine = new LocalSidEngine({ workerFactory: () => worker });
    const tune = new ArrayBuffer(64);

    engine.prerender("tune#0", tune, 0, 30);

    const { roms, transfer } = romsOf(worker, "prerender");
    expect(roms).toBeUndefined();
    expect(transfer).toEqual([tune]);
  });

  it("warms a lead-in with the stored ROMs", () => {
    const workers: RecordingWorker[] = [];
    const engine = new LocalSidEngine({
      workerFactory: () => {
        const worker = new RecordingWorker();
        workers.push(worker);
        return worker;
      },
    });

    engine.warmLeadIn("tune#0", new ArrayBuffer(64), 0, 10);

    const { roms } = romsOf(workers[0], "prerender");
    expect([bytesOf(roms!.kernal), bytesOf(roms!.basic), bytesOf(roms!.chargen)]).toEqual([
      [8192, 1],
      [8192, 2],
      [4096, 3],
    ]);
  });
});
