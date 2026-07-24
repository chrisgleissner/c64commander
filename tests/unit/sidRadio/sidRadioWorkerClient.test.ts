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
});
