/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { buildReadyStats } from "@/lib/sidRadio/sidRadioWorkerCore";
import { SidRadioWorkerClient, SidRadioWorkerUnavailableError } from "@/lib/sidRadio/sidRadioWorkerClient";
import type { SidRadioMainToWorker, SidRadioWorkerToMain } from "@/lib/sidRadio/sidRadioWorkerProtocol";
import { buildDefaultTinyFixture } from "../../fixtures/sidcorr/buildTinyFixture";

/** In-process stand-in for the real Worker, driven by a response function. */
class FakeWorker extends EventTarget {
  terminated = false;
  lastTransfer: Transferable[] | undefined;

  constructor(private readonly respond: (message: SidRadioMainToWorker) => SidRadioWorkerToMain | null) {
    super();
  }

  postMessage(message: SidRadioMainToWorker, transfer?: Transferable[]) {
    this.lastTransfer = transfer;
    queueMicrotask(() => {
      const response = this.respond(message);
      if (response) this.dispatchEvent(new MessageEvent("message", { data: response }));
    });
  }

  terminate() {
    this.terminated = true;
  }
}

const readyFactory = () =>
  new FakeWorker((message) => {
    if (message.type !== "load") return null;
    const bundle = message.bundle ?? buildDefaultTinyFixture();
    return { type: "ready", stats: buildReadyStats(bundle, false) };
  }) as unknown as Worker;

/** A factory that counts the `load` messages the worker actually receives. */
const countingLoadFactory = (
  respond: (loads: number) => SidRadioWorkerToMain = () => ({
    type: "ready",
    stats: buildReadyStats(buildDefaultTinyFixture(), false),
  }),
) => {
  const counter = { loads: 0 };
  const factory = () =>
    new FakeWorker((message) => {
      if (message.type !== "load") return null;
      counter.loads += 1;
      return respond(counter.loads);
    }) as unknown as Worker;
  return { counter, factory };
};

describe("SidRadioWorkerClient", () => {
  it("resolves load() with ready stats posted off the main thread", async () => {
    const client = new SidRadioWorkerClient(readyFactory);
    const stats = await client.load();
    expect(stats.engineThreadIsMain).toBe(false);
    expect(stats.fileCount).toBe(3);
    expect(stats.trackCount).toBe(4);
    client.terminate();
  });

  it("transfers a provided bundle to the worker", async () => {
    let seen: FakeWorker | null = null;
    const client = new SidRadioWorkerClient(() => {
      const worker = new FakeWorker((message) => ({
        type: "ready",
        stats: buildReadyStats(message.bundle ?? buildDefaultTinyFixture(), false),
      }));
      seen = worker;
      return worker as unknown as Worker;
    });
    const bundle = buildDefaultTinyFixture();
    await client.load({ bundle });
    expect(seen!.lastTransfer).toEqual([bundle]);
  });

  /**
   * The launcher preloads the style populations while a tile tap starts a station,
   * so two `load()`s legitimately overlap. The client holds one pending resolver:
   * a second `load` message used to replace it, leaving the preload unanswered
   * until its 15 s timeout — which then warned and nulled out whichever load was
   * pending by then, so a later station start could be dropped too.
   */
  it("shares one worker load across overlapping load() calls", async () => {
    const { counter, factory } = countingLoadFactory();
    const client = new SidRadioWorkerClient(factory);
    const [first, second] = await Promise.all([client.load({ timeoutMs: 60_000 }), client.load({ timeoutMs: 60_000 })]);
    expect(counter.loads).toBe(1);
    expect(first).toBe(second);
    // Once loaded, a later caller reuses it instead of re-parsing the bundle the
    // worker still holds for `compute`.
    expect(await client.load()).toBe(first);
    expect(counter.loads).toBe(1);
    client.terminate();
  });

  it("retries a failed load instead of caching the rejection forever", async () => {
    const { counter, factory } = countingLoadFactory((loads) =>
      loads === 1
        ? { type: "error", code: "magic", message: "bad magic" }
        : { type: "ready", stats: buildReadyStats(buildDefaultTinyFixture(), false) },
    );
    const client = new SidRadioWorkerClient(factory);
    await expect(client.load()).rejects.toThrow(/magic/);
    await expect(client.load()).resolves.toMatchObject({ fileCount: 3 });
    expect(counter.loads).toBe(2);
    client.terminate();
  });

  it("re-loads after terminate() rather than vouching for a discarded worker", async () => {
    const { counter, factory } = countingLoadFactory();
    const client = new SidRadioWorkerClient(factory);
    await client.load();
    client.terminate();
    // The worker holding the parsed bundle is gone, so the memo must go with it.
    await client.load();
    expect(counter.loads).toBe(2);
    client.terminate();
  });

  it("rejects load() when the worker reports a typed error", async () => {
    const client = new SidRadioWorkerClient(
      () => new FakeWorker(() => ({ type: "error", code: "magic", message: "bad magic" })) as unknown as Worker,
    );
    await expect(client.load()).rejects.toThrow(/magic/);
  });

  it("rejects when the worker never answers (timeout)", async () => {
    const client = new SidRadioWorkerClient(() => new FakeWorker(() => null) as unknown as Worker);
    await expect(client.load({ timeoutMs: 20 })).rejects.toThrow(/timed out/);
  });

  it("refuses to run on the main thread when Web Workers are unavailable (§8.6 guard)", async () => {
    // jsdom has no Worker → the default factory throws instead of falling back
    // to a synchronous main-thread parse.
    expect(SidRadioWorkerClient.isSupported()).toBe(false);
    const client = new SidRadioWorkerClient();
    await expect(client.load()).rejects.toBeInstanceOf(SidRadioWorkerUnavailableError);
  });

  it("fails a pending load fast on a worker 'error' event (not just the timeout)", async () => {
    const worker = new FakeWorker(() => null); // never answers normally
    const client = new SidRadioWorkerClient(() => worker as unknown as Worker);
    const loadP = client.load({ timeoutMs: 60_000 });
    queueMicrotask(() => worker.dispatchEvent(new ErrorEvent("error", { message: "worker crashed" })));
    await expect(loadP).rejects.toThrow(/worker crashed/);
    client.terminate();
  });

  it("fails a pending load on a worker 'messageerror' (undeserializable message)", async () => {
    const worker = new FakeWorker(() => null);
    const client = new SidRadioWorkerClient(() => worker as unknown as Worker);
    const loadP = client.load({ timeoutMs: 60_000 });
    queueMicrotask(() => worker.dispatchEvent(new Event("messageerror")));
    await expect(loadP).rejects.toThrow(/deserialized/);
    client.terminate();
  });

  it("fails in-flight compute requests when the worker errors", async () => {
    // Load succeeds; a compute is left pending, then the worker crashes.
    const worker = new FakeWorker((message) => {
      if (message.type !== "load") return null; // compute never answers
      return { type: "ready", stats: buildReadyStats(buildDefaultTinyFixture(), false) };
    });
    const client = new SidRadioWorkerClient(() => worker as unknown as Worker);
    await client.load();
    const computeP = client.compute(
      {
        seed: { kind: "song", md5_48: "abcdef012345" },
        shuffleSeed: 1,
        likes: [],
        notForMe: [],
        exclude: [],
        count: 4,
      },
      60_000,
    );
    queueMicrotask(() => worker.dispatchEvent(new ErrorEvent("error", { message: "died mid-compute" })));
    await expect(computeP).rejects.toThrow(/died mid-compute/);
    client.terminate();
  });
});
