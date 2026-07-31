/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { SidRadioWorkerClient } from "@/lib/sidRadio/sidRadioWorkerClient";
import { computeStationResponse, readyStatsFromBundle, toWorkerErrorMessage } from "@/lib/sidRadio/sidRadioWorkerCore";
import { SidcorrParseError, parseSidcorrTiny, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";
import type { SidRadioMainToWorker, SidRadioWorkerToMain } from "@/lib/sidRadio/sidRadioWorkerProtocol";
import { buildTinyFixture } from "../fixtures/sidcorr/buildTinyFixture";

// The §8.3 worker contract test: pins every main↔worker message shape (§6.5)
// and round-trips through the *real* worker core so the two sides cannot drift.

/** A FakeWorker that runs the real worker's onmessage logic against a fixture. */
class ContractWorker extends EventTarget {
  private bundle: SidcorrTinyBundle | null = null;
  constructor(private readonly bundleBytes: ArrayBuffer) {
    super();
  }
  postMessage(message: SidRadioMainToWorker) {
    queueMicrotask(() => {
      let response: SidRadioWorkerToMain;
      try {
        if (message.type === "load") {
          this.bundle = parseSidcorrTiny(this.bundleBytes);
          response = { type: "ready", stats: readyStatsFromBundle(this.bundle, false) };
        } else if (message.type === "compute") {
          if (!this.bundle)
            response = { type: "error", id: message.id, code: "not-loaded", message: "bundle not loaded" };
          else response = computeStationResponse(this.bundle, message.id, message.request);
        } else {
          response = { type: "error", code: "bad-message", message: "unknown" };
        }
      } catch (error) {
        response = toWorkerErrorMessage(error);
      }
      this.dispatchEvent(new MessageEvent("message", { data: response }));
    });
  }
  terminate() {}
}

const fixtureBytes = () =>
  buildTinyFixture({
    files: [
      { md5_48: "aaaaaaaaaaaa", tracks: [{ styleMask: 0b01 }] },
      { md5_48: "bbbbbbbbbbbb", tracks: [{ styleMask: 0b01, neighbors: [0] }] },
      { md5_48: "cccccccccccc", tracks: [{ styleMask: 0b10, neighbors: [1, 0] }] },
      { md5_48: "dddddddddddd", tracks: [{ styleMask: 0b01, neighbors: [2, 1] }] },
    ],
  });

const clientFor = (bytes: ArrayBuffer) =>
  new SidRadioWorkerClient(() => new ContractWorker(bytes) as unknown as Worker);

describe("sidRadio worker contract (§8.3)", () => {
  it("load → ready with the §9.4 stat keys", async () => {
    const stats = await clientFor(fixtureBytes()).load();
    expect(stats).toMatchObject({
      fileCount: 4,
      trackCount: 4,
      styleCount: 9,
      engineThreadIsMain: false,
    });
    expect(typeof stats.bundleLoadMs).toBe("number");
    expect(typeof stats.memoryEstimateBytes).toBe("number");
    // The launcher sizes its tiles from these, so they cross the boundary too.
    expect(stats.stylePopulations).toMatchObject({ fast_paced: 3, slow_ambient: 1, theme_hunter: 0 });
  });

  it("compute → candidates for a resolvable seed", async () => {
    const client = clientFor(fixtureBytes());
    await client.load();
    const result = await client.compute({
      seed: { kind: "song", md5_48: "dddddddddddd" },
      shuffleSeed: 7,
      likes: [],
      notForMe: [],
      exclude: [],
      recent: [],
      count: 10,
    });
    expect(result.empty).toBeUndefined();
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate).toMatchObject({
        trackOrdinal: expect.any(Number),
        md5_48: expect.any(String),
        songIndex: expect.any(Number),
        reason: expect.any(String),
        // The queue provider retires a whole `.sid` file when it plays one subsong, so the file's
        // track ordinals have to cross the boundary with the candidate.
        fileTrackOrdinals: expect.any(Array),
      });
    }
  });

  it("carries the drifting query's recent window across the boundary", async () => {
    // `recent` is only useful if it survives structured cloning in order, so assert it by result:
    // the same seed with a different history has to reach a different part of the graph.
    const client = clientFor(fixtureBytes());
    await client.load();
    const request = {
      seed: { kind: "song" as const, md5_48: "aaaaaaaaaaaa" },
      shuffleSeed: 7,
      likes: [],
      notForMe: [],
      exclude: [3],
      recent: [] as number[],
      count: 10,
    };
    const withoutHistory = await client.compute(request);
    const withHistory = await client.compute({ ...request, recent: [3] });
    expect(withoutHistory.candidates.map((candidate) => candidate.score)).not.toEqual(
      withHistory.candidates.map((candidate) => candidate.score),
    );
  });

  it("compute → empty for an unknown seed", async () => {
    const client = clientFor(fixtureBytes());
    await client.load();
    const result = await client.compute({
      seed: { kind: "song", md5_48: "999999999999" },
      shuffleSeed: 7,
      likes: [],
      notForMe: [],
      exclude: [],
      recent: [],
      count: 10,
    });
    expect(result.candidates).toEqual([]);
    expect(result.empty).toBe("no-neighbours");
  });

  it("maps a parse error to a typed worker error (never a throw that kills the worker)", () => {
    const message = toWorkerErrorMessage(new SidcorrParseError("magic", "bad magic"));
    expect(message).toEqual({ type: "error", code: "magic", message: "bad magic" });
  });

  // The worker's own guarantee: a compute it cannot answer comes back as a typed error, never a
  // hang and never a throw that kills the worker. Asserted against the worker directly, because
  // the client no longer lets a compute reach it in that state (see the next test).
  it("answers a compute with no bundle with a typed not-loaded error", async () => {
    const worker = new ContractWorker(fixtureBytes());
    const reply = await new Promise<SidRadioWorkerToMain>((resolve) => {
      worker.addEventListener("message", (event) => resolve((event as MessageEvent).data), { once: true });
      worker.postMessage({
        type: "compute",
        id: 1,
        request: {
          seed: { kind: "song", md5_48: "aaaaaaaaaaaa" },
          shuffleSeed: 1,
          likes: [],
          notForMe: [],
          exclude: [],
          recent: [],
          count: 5,
        },
      });
    });
    expect(reply).toEqual({ type: "error", id: 1, code: "not-loaded", message: "bundle not loaded" });
  });

  // A station restored at launch rebuilds its provider and refills immediately, with nothing on
  // that path having loaded the bundle. The client closes that race for every caller by awaiting
  // its own memoised load, so a compute is served rather than rejected.
  it("loads the bundle on demand, so a compute needs no preceding load()", async () => {
    const client = clientFor(fixtureBytes());
    const result = await client.compute({
      seed: { kind: "song", md5_48: "aaaaaaaaaaaa" },
      shuffleSeed: 1,
      likes: [],
      notForMe: [],
      exclude: [],
      recent: [],
      count: 5,
    });
    expect(result.candidates.length).toBeGreaterThan(0);
  });
});
