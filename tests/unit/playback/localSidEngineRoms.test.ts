/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({
  kernal: new Uint8Array(8192).fill(1),
  basic: new Uint8Array(8192).fill(2),
  chargen: new Uint8Array(4096).fill(3),
}));
vi.mock("@/lib/roms/romStore", () => ({ loadStoredRoms: () => stored, hasCompleteRomSet: () => true }));

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
});
