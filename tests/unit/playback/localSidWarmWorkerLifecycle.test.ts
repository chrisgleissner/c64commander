/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

import { LocalSidEngine, type LocalSidWorkerLike } from "@/lib/playback/localSidEngine";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";

vi.mock("@/lib/roms/romStore", () => ({
  loadStoredRoms: () => ({ kernal: new Uint8Array(8192), basic: new Uint8Array(8192) }),
  hasCompleteRomSet: () => true,
}));

/**
 * The lead-in renderer's own lifecycle.
 *
 * It is a third worker thread, separate from playback and pre-render, and nothing else in the
 * engine terminates it. Its failure and teardown paths therefore have to release it themselves.
 */

class FakeWorker implements LocalSidWorkerLike {
  readonly sent: LocalSidMainToWorker[] = [];
  terminated = false;
  private errorHandler: ((event: { message?: string }) => void) | null = null;
  private messageErrorHandler: (() => void) | null = null;

  postMessage(message: LocalSidMainToWorker): void {
    this.sent.push(message);
  }
  addEventListener(type: string, handler: (...args: never[]) => void): void {
    if (type === "error") this.errorHandler = handler as typeof this.errorHandler;
    else if (type === "messageerror") this.messageErrorHandler = handler as typeof this.messageErrorHandler;
  }
  terminate(): void {
    this.terminated = true;
  }
  emitError(message: string): void {
    this.errorHandler?.({ message });
  }
  emitMessageError(): void {
    this.messageErrorHandler?.();
  }
  ofType<T extends LocalSidMainToWorker["type"]>(type: T): Extract<LocalSidMainToWorker, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<LocalSidMainToWorker, { type: T }>[];
  }
}

/** An engine whose only worker traffic is lead-in warming, so the factory order is unambiguous. */
const makeWarmOnlyEngine = () => {
  const built: FakeWorker[] = [];
  const engine = new LocalSidEngine({
    workerFactory: () => {
      const worker = new FakeWorker();
      built.push(worker);
      return worker as unknown as LocalSidWorkerLike;
    },
  });
  return { engine, built };
};

const someTune = () => new ArrayBuffer(8);

describe("LocalSidEngine — the lead-in renderer's lifecycle", () => {
  it("terminates a lead-in renderer that crashes, instead of only dropping the reference", async () => {
    const { engine, built } = makeWarmOnlyEngine();
    engine.warmLeadIn("first#0", someTune(), 0, 4);
    expect(built).toHaveLength(1);

    built[0].emitError("segfault");

    expect(built[0].terminated).toBe(true);
  });

  it("terminates a lead-in renderer whose message could not be deserialized", async () => {
    const { engine, built } = makeWarmOnlyEngine();
    engine.warmLeadIn("first#0", someTune(), 0, 4);

    built[0].emitMessageError();

    expect(built[0].terminated).toBe(true);
  });

  it("starts the warm queued behind a crashed renderer, as the reply paths do", async () => {
    const { engine, built } = makeWarmOnlyEngine();
    engine.warmLeadIn("first#0", someTune(), 0, 4);
    // One at a time: the second request queues behind the first.
    engine.warmLeadIn("second#0", someTune(), 0, 4);
    expect(built).toHaveLength(1);

    built[0].emitError("segfault");

    // The queued lead-in has to run on a replacement thread; without draining it waited for a
    // completion that can no longer arrive, and the next skip lost its warmed start.
    expect(built).toHaveLength(2);
    expect(built[1].ofType("prerender")).toHaveLength(1);
  });

  it("ignores a late failure from a renderer it has already replaced", async () => {
    // The listeners outlive the worker they belong to. Without an identity check, a late `error`
    // from the crashed original terminated the replacement the next warm had just built — a healthy
    // thread killed by a dead one's parting message.
    const { engine, built } = makeWarmOnlyEngine();
    engine.warmLeadIn("first#0", someTune(), 0, 4);
    built[0].emitError("segfault");
    expect(built[0].terminated).toBe(true);

    engine.warmLeadIn("second#0", someTune(), 0, 4);
    expect(built).toHaveLength(2);

    // The original, already discarded, reports again.
    built[0].emitError("late segfault");

    expect(built[1].terminated).toBe(false);
  });

  it("terminates the lead-in renderer on dispose(), so a teardown leaks no thread", async () => {
    const { engine, built } = makeWarmOnlyEngine();
    engine.warmLeadIn("first#0", someTune(), 0, 4);
    expect(built).toHaveLength(1);

    engine.dispose();

    expect(built[0].terminated).toBe(true);
  });
});
