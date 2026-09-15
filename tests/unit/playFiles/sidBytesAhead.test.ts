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
      item("previous", { arrayBuffer: async () => Promise.reject(new Error("gone")) }),
      item("current"),
      item("next"),
    ];
    const resolve = vi.fn(async () => {
      throw new Error("library not ready");
    });

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
});
