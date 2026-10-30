/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import type { PlaylistItem } from "@/pages/playFiles/types";

const router = vi.hoisted(() => ({ fetch: vi.fn() }));
const hvsc = vi.hoisted(() => ({ durations: vi.fn() }));

vi.mock("@/lib/playback/playbackRouter", () => ({ tryFetchUltimateSidBlob: router.fetch }));
vi.mock("@/lib/hvsc", () => ({ getHvscDurationsByMd5Seconds: hvsc.durations }));
vi.mock("@/lib/sid/sidUtils", () => ({ computeSidMd5: vi.fn(async () => "md5") }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

import { addErrorLog, addLog } from "@/lib/logging";
import {
  LEAD_IN_SECONDS,
  resolveHvscDurationSecondsForSongNr,
  resolveUltimateSidDurationByMd5,
  warmNeighbouringLeadIns,
} from "@/pages/playFiles/sidBytesAhead";

const item = (id: string, file?: { arrayBuffer: () => Promise<ArrayBuffer> }) =>
  ({
    id,
    label: `${id}.sid`,
    request: { source: "hvsc", path: `/${id}.sid`, file, songNr: 1 },
  }) as unknown as PlaylistItem;

describe("reading SID bytes ahead", () => {
  beforeEach(() => {
    router.fetch.mockReset();
    hvsc.durations.mockReset();
    vi.mocked(addLog).mockClear();
    vi.mocked(addErrorLog).mockClear();
  });

  it("looks up the duration of the requested subsong, and nothing for a subsong the tune does not have", async () => {
    hvsc.durations.mockResolvedValue([100, 42]);

    expect(await resolveHvscDurationSecondsForSongNr("md5", 2)).toBe(42);
    expect(await resolveHvscDurationSecondsForSongNr("md5", 3)).toBeNull();
    expect(await resolveHvscDurationSecondsForSongNr("md5")).toBe(100);
  });

  it("answers a tune on the Ultimate with its duration by md5, and with nothing when the read fails", async () => {
    router.fetch.mockResolvedValueOnce(new Blob([new Uint8Array([1, 2, 3])]));
    hvsc.durations.mockResolvedValue([90]);

    expect(await resolveUltimateSidDurationByMd5("/tune.sid", 1)).toBe(90_000);

    router.fetch.mockRejectedValueOnce(new Error("Host unreachable"));

    expect(await resolveUltimateSidDurationByMd5("/tune.sid", 1)).toBeNull();
    expect(addErrorLog).toHaveBeenCalledWith("Ultimate SID MD5 duration lookup failed", {
      path: "/tune.sid",
      error: "Host unreachable",
    });
  });

  it("warms the neighbours it can read and carries on past one it cannot resolve or read", async () => {
    const warmLeadIn = vi.fn();
    const controller = { warmLeadIn } as unknown as LocalSidPlaybackController;
    const bytes = new ArrayBuffer(4);
    const playlist = [
      item("previous", { arrayBuffer: async () => Promise.reject("gone") }),
      item("current"),
      item("next"),
    ];
    const resolve = vi.fn(() => Promise.reject("library not ready"));

    await warmNeighbouringLeadIns(playlist, 1, resolve, controller);

    expect(warmLeadIn).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      "debug",
      "Playback: could not resolve a neighbouring track for lead-in warming",
      { error: "library not ready" },
    );
    expect(addLog).toHaveBeenCalledWith("debug", "Lead-in warm skipped", {
      service: "local-sid",
      item: "previous.sid",
      error: "gone",
    });

    playlist[2] = item("next", { arrayBuffer: async () => bytes });
    await warmNeighbouringLeadIns(playlist, 1, resolve, controller);

    expect(warmLeadIn).toHaveBeenCalledWith(expect.stringContaining("next"), bytes, 0, LEAD_IN_SECONDS);
  });

  it("warms an Ultimate-hosted neighbour from prefetched bytes, and leaves it alone when none were prefetched", async () => {
    const warmLeadIn = vi.fn();
    const controller = { warmLeadIn } as unknown as LocalSidPlaybackController;
    const next = {
      id: "next",
      label: "next.sid",
      request: { source: "ultimate", path: "/Usb0/next.sid", songNr: 1 },
    } as unknown as PlaylistItem;
    const playlist = [item("current", { arrayBuffer: async () => new ArrayBuffer(1) }), next];
    const resolve = vi.fn(async () => null);

    await warmNeighbouringLeadIns(playlist, 0, resolve, controller, () => null);
    expect(warmLeadIn).not.toHaveBeenCalled();

    await warmNeighbouringLeadIns(playlist, 0, resolve, controller, () => new Blob([new Uint8Array([1, 2, 3])]));
    expect(warmLeadIn).toHaveBeenCalledTimes(1);
    expect(warmLeadIn).toHaveBeenCalledWith(
      expect.stringContaining("next"),
      expect.any(ArrayBuffer),
      0,
      LEAD_IN_SECONDS,
    );
  });

  it("warms the song after one the playlist would pass over, in either direction", async () => {
    const warmLeadIn = vi.fn();
    const controller = { warmLeadIn } as unknown as LocalSidPlaybackController;
    const bytesOf = (marker: number) => ({ arrayBuffer: async () => new Uint8Array([marker]).buffer });
    const playlist = [
      item("before", bytesOf(1)),
      item("skippedBefore", bytesOf(2)),
      item("current", bytesOf(3)),
      item("skipped", bytesOf(4)),
      item("skippedToo", bytesOf(5)),
      item("next", bytesOf(6)),
    ];
    const passedOver = vi.fn(async (sidBytes: Uint8Array) => [2, 4, 5].includes(sidBytes[0]));

    await warmNeighbouringLeadIns(playlist, 2, vi.fn(), controller, undefined, passedOver);

    expect(warmLeadIn.mock.calls.map(([key]) => key)).toEqual([
      expect.stringContaining("next"),
      expect.stringContaining("before"),
    ]);
    expect(passedOver).toHaveBeenCalledWith(expect.any(Uint8Array), 1);
  });

  it("gives up looking past passed-over songs after a few, and warms nothing then", async () => {
    const warmLeadIn = vi.fn();
    const controller = { warmLeadIn } as unknown as LocalSidPlaybackController;
    const playlist = Array.from({ length: 8 }, (_, index) =>
      item(`song${index}`, { arrayBuffer: async () => new ArrayBuffer(1) }),
    );
    const passedOver = vi.fn(async () => true);

    await warmNeighbouringLeadIns(playlist, 0, vi.fn(), controller, undefined, passedOver);

    expect(warmLeadIn).not.toHaveBeenCalled();
    expect(passedOver).toHaveBeenCalledTimes(5);
  });
});
