/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * How songs that need the C64 ROMs move through starts, questions, repeats and moves: a tune whose header
 * declares BASIC with no ROMs stored, the first song of a station or of Play with nothing chosen, Cancel
 * and Stop around the question, and a song the listener already accepted being started again. Fixture and
 * harness as in `usePlaybackController.romDependency.test.tsx`.
 */

import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlayPlan } from "@/lib/playback/playbackRouter";
import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { toast } from "@/hooks/use-toast";
import { addLog } from "@/lib/logging";
import { savePlaybackEngine } from "@/lib/config/appSettings";
import { setRomDependencyAssetsForTests } from "@/lib/romDependency/embeddedRomDependencyList";
import { romListedSkippedNotice } from "@/pages/playFiles/romDependencyGate";
import { resetRomSkipNoticeForTests } from "@/pages/playFiles/resolveLocalRoute";
import { ENGINE_FALLBACK_MESSAGES } from "@/lib/playback/playbackEngineRouting";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { FAKE_ROMS, syntheticAssets } from "../../helpers/romDependencyFixture";
import {
  attempt,
  basicRsid,
  fakeController,
  listed,
  plain,
  program,
  renderController,
} from "../../helpers/romDependencyController";

const connectionState = vi.hoisted(() => ({ current: "OFFLINE_NO_DEMO" as string }));
const storedRoms = vi.hoisted(() => ({ current: {} as Record<string, Uint8Array> }));

vi.mock("@/lib/connection/connectionManager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connection/connectionManager")>();
  return {
    ...actual,
    getConnectionSnapshot: () => ({ ...actual.getConnectionSnapshot(), state: connectionState.current }),
  };
});

vi.mock("@/lib/roms/romStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/roms/romStore")>();
  return {
    ...actual,
    hasCompleteRomSet: () => Boolean(storedRoms.current.kernal && storedRoms.current.basic),
    loadStoredRoms: () => storedRoms.current,
  };
});

vi.mock("@/lib/roms/ensureSystemRoms", () => ({ ensureSystemRoms: vi.fn(async () => false) }));

vi.mock("@/lib/archive/client", () => ({ createArchiveClient: vi.fn() }));
vi.mock("@/lib/archive/execution", () => ({ buildArchivePlayPlan: vi.fn() }));
// The simulated device is told what plays, so its screen can name it.
vi.mock("@/lib/c64api", () => ({ getC64API: vi.fn(() => ({ playSid: vi.fn(async () => undefined) })) }));
vi.mock("@/lib/playback/playbackRouter", () => ({
  PlaybackLaunchOvertakenError: class extends Error {},
  buildPlayPlan: vi.fn((request) => request),
  executePlayPlan: vi.fn(async () => undefined),
  getRememberedUltimateSidBlob: vi.fn(() => null),
  tryFetchUltimateSidBlob: vi.fn(async () => null),
}));
vi.mock("@/lib/hvsc", () => ({
  getHvscDurationByMd5Seconds: vi.fn(async () => null),
  getHvscDurationsByMd5Seconds: vi.fn(async () => null),
}));
// The fixture's file hashes to the listed MD5; any other bytes hash to something unlisted.
vi.mock("@/lib/sid/sidUtils", () => ({
  getSidSongCount: vi.fn(() => 3),
  computeSidMd5: vi.fn(async (data: ArrayBuffer) =>
    data.byteLength === 0x7c + 2 ? "788728f8e8eb6f7e2c5918b28383a1d6" : "ffffffffffffffffffffffffffffffff",
  ),
}));
vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));
vi.mock("@/lib/uiErrors", () => ({
  DEVICE_NOT_CONNECTED_MESSAGE: "Device not connected. Check connection settings.",
  reportUserError: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/config/applyConfigFileReference", () => ({ applyConfigFileReference: vi.fn(async () => undefined) }));

const toastDescriptions = () => vi.mocked(toast).mock.calls.map(([t]) => (t as { description?: string }).description);
const skipNotices = () => toastDescriptions().filter((text) => text?.startsWith("Skipped"));
const romLog = () =>
  vi
    .mocked(addLog)
    .mock.calls.filter(([, message]) => message === "Song needs the C64 ROMs on this device")
    .map(([, , details]) => details as Record<string, unknown>);

/** A question that stays open until the test answers it. */
const heldQuestion = () => {
  let answer: (choice: "play-anyway" | "cancel") => void = () => undefined;
  const decide = vi.fn(
    () =>
      new Promise<"play-anyway" | "cancel">((resolve) => {
        answer = resolve;
      }),
  );
  return { decide, answer: (choice: "play-anyway" | "cancel") => answer(choice) };
};

describe("songs that need the C64 ROMs: starts, questions, repeats and moves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRomSkipNoticeForTests();
    localStorage.clear();
    connectionState.current = "OFFLINE_NO_DEMO";
    storedRoms.current = {};
    localStorage.setItem("c64u_sid_renderer", "sidlite");
    vi.spyOn(LocalSidPlaybackController, "isSupported").mockReturnValue(true);
    const { assets, pin } = syntheticAssets();
    setRomDependencyAssetsForTests(async () => assets, pin);
  });
  afterEach(() => {
    setRomDependencyAssetsForTests(null);
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe.each(["OFFLINE_NO_DEMO", "DEMO_ACTIVE"])("a tune that declares BASIC, no ROMs stored, %s", (state) => {
    beforeEach(() => {
      connectionState.current = state;
    });

    it("is passed over by auto-advance, which plays the next tune here instead of failing for want of a C64", async () => {
      const controller = fakeController();
      const playlist = [plain("a"), basicRsid("b"), plain("c")];
      const { result } = renderController(playlist, controller);
      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      await act(async () => {
        await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
      });

      expect(result.current.currentIndex).toBe(2);
      expect(result.current.isPlaying).toBe(true);
      expect(controller.play).toHaveBeenCalledTimes(2);
      expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
      expect(skipNotices()).toEqual([romListedSkippedNotice("BASIC b")]);
      // The list does not name it: the header's requirement is the reason.
      expect(romLog()).toEqual([expect.objectContaining({ basis: "header", lane: null, outcome: "skip" })]);
    });

    it("is passed over at the start of a station", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const items = [basicRsid("b"), plain("c")];
      const { result } = renderController([], controller, { decide, station: true });

      await act(async () => {
        await result.current.startPlaylist(items, 0, { replaceQueue: true, passOver: true });
      });

      expect(decide).not.toHaveBeenCalled();
      expect(result.current.currentIndex).toBe(1);
      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
    });

    it("is asked about when tapped, and plays here on Play anyway", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "play-anyway" as const);
      const playlist = [basicRsid("b")];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      expect(decide).toHaveBeenCalledWith(playlist[0]);
      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
      expect(result.current.isPlaying).toBe(true);
    });

    it("is asked about when tapped, and nothing is sent anywhere on Cancel", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [basicRsid("b")];
      const { result } = renderController(playlist, controller, { decide });

      expect(await attempt(() => result.current.playItem(playlist[0], { playlistIndex: 0 }))).toBeUndefined();

      expect(decide).toHaveBeenCalledTimes(1);
      expect(controller.play).not.toHaveBeenCalled();
      expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
      expect(result.current.isPlaying).toBe(false);
    });
  });

  describe("a tune that declares BASIC and that the list grades", () => {
    it("uses the list's grade for the lane in use: below the threshold it is asked about", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [basicRsid("b", 1, true)];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      expect(decide).toHaveBeenCalledTimes(1);
      expect(romLog()).toEqual([
        expect.objectContaining({ basis: "list", lane: "sidliteNone", grade: 0, approximate: false, outcome: "ask" }),
      ]);
    });

    it("plays it here without a question when the list grades it at the threshold without ROMs", async () => {
      // synthetic.sid subtune 3 grades 128 in the SIDLite no-ROMs lane: the header's flag is not the last word.
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [basicRsid("b", 3, true)];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto" });
      });

      expect(decide).not.toHaveBeenCalled();
      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
    });

    it("still goes to a C64 that can play it, without consulting the list", async () => {
      connectionState.current = "REAL_CONNECTED";
      localStorage.setItem("c64u_local_engine_enabled", "1");
      localStorage.setItem("c64u_playback_engine", "local");
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [basicRsid("b")];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      expect(decide).not.toHaveBeenCalled();
      expect(controller.play).not.toHaveBeenCalled();
      expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
      expect(toastDescriptions()).toContain(ENGINE_FALLBACK_MESSAGES["rom-on-c64"]);
    });
  });

  describe("the first song of something the listener did not pick a song from", () => {
    it("passes over a listed first song when Play starts the playlist with nothing chosen", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [listed("b", 1), plain("c")];
      const { result } = renderController(playlist, controller, { decide, currentIndex: -1 });

      await act(async () => {
        await result.current.handlePlay();
      });

      expect(decide).not.toHaveBeenCalled();
      expect(result.current.currentIndex).toBe(1);
      expect(controller.play).toHaveBeenCalledTimes(1);
    });

    it("still asks about a song the listener tapped in a list", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "play-anyway" as const);
      const playlist = [plain("a"), listed("b", 1)];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.startPlaylist(playlist, 1);
      });

      expect(decide).toHaveBeenCalledWith(playlist[1]);
      expect(result.current.currentIndex).toBe(1);
    });

    it("ends without playing anything when every song of a station needs the ROMs", async () => {
      const controller = fakeController();
      const items = [listed("b", 1), basicRsid("c")];
      const { result } = renderController([], controller, { station: true });

      await act(async () => {
        await result.current.startPlaylist(items, 0, { replaceQueue: true, passOver: true });
      });

      expect(controller.play).not.toHaveBeenCalled();
      expect(result.current.isPlaying).toBe(false);
      expect(skipNotices()).toHaveLength(1);
    });
  });

  describe("Cancel leaves what is playing alone", () => {
    it("keeps the tune playing, its auto-advance armed and its time, when a tapped row is declined", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [plain("a"), listed("b", 1)];
      const { result } = renderController(playlist, controller, { decide });
      await act(async () => {
        await result.current.startPlaylist(playlist, 0);
      });
      const guard = result.current.autoAdvanceGuardRef.current;
      expect(guard).not.toBeNull();
      const reset = vi.mocked(result.current.playedClockRef.current.reset);
      reset.mockClear();

      await act(async () => {
        await result.current.startPlaylist(playlist, 1);
      });

      expect(decide).toHaveBeenCalledTimes(1);
      expect(controller.stop).not.toHaveBeenCalled();
      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(result.current.isPlaying).toBe(true);
      expect(result.current.currentIndex).toBe(0);
      expect(reset).not.toHaveBeenCalled();
      expect(result.current.autoAdvanceGuardRef.current).toBe(guard);
      expect(guard?.userCancelled).toBe(false);
      expect(result.current.autoAdvanceDueAtMs).toBe(guard?.dueAtMs);
    });

    it("leaves a stopped player stopped when Play on a listed song is declined", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.handlePlay();
      });

      expect(decide).toHaveBeenCalledTimes(1);
      expect(controller.play).not.toHaveBeenCalled();
      expect(result.current.isPlaying).toBe(false);
    });
  });

  describe("an answer that comes after the listener moved on", () => {
    it("does not play a song confirmed with Play anyway after Stop was pressed while the question was open", async () => {
      const controller = fakeController();
      const question = heldQuestion();
      const playlist = [plain("a"), listed("b", 1)];
      const { result } = renderController(playlist, controller, { decide: question.decide });
      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });
      let launch: Promise<unknown> = Promise.resolve();
      act(() => {
        launch = result.current.playItem(playlist[1], { playlistIndex: 1 });
      });
      await waitFor(() => expect(question.decide).toHaveBeenCalledTimes(1));

      await act(async () => {
        await result.current.handleStop();
      });
      await act(async () => {
        question.answer("play-anyway");
        await launch;
      });

      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(result.current.isPlaying).toBe(false);
    });

    it("does not play it over a newer launch that came while the question was open", async () => {
      const controller = fakeController();
      const question = heldQuestion();
      const playlist = [plain("a"), listed("b", 1), plain("c")];
      const { result } = renderController(playlist, controller, { decide: question.decide });
      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });
      let launch: Promise<unknown> = Promise.resolve();
      act(() => {
        launch = result.current.playItem(playlist[1], { playlistIndex: 1 });
      });
      await waitFor(() => expect(question.decide).toHaveBeenCalledTimes(1));

      await act(async () => {
        await result.current.playItem(playlist[2], { playlistIndex: 2 });
      });
      await act(async () => {
        question.answer("play-anyway");
        await launch;
      });

      expect(controller.play).toHaveBeenCalledTimes(2);
      expect(result.current.currentIndex).toBe(2);
    });
  });

  describe("a song the listener already accepted, started again", () => {
    it("repeats it under Repeat one instead of passing over it", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "play-anyway" as const);
      const playlist = [listed("b", 1), plain("c")];
      const { result } = renderController(playlist, controller, { decide, repeatOneEnabled: true });
      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      await act(async () => {
        await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
      });

      expect(controller.play).toHaveBeenCalledTimes(2);
      expect(result.current.currentIndex).toBe(0);
      expect(decide).toHaveBeenCalledTimes(1);
      expect(skipNotices()).toEqual([]);
    });

    it("plays on when started again as the tune already playing, with no question and no notice", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto", romDependencyAccepted: true });
      });

      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(decide).not.toHaveBeenCalled();
      expect(skipNotices()).toEqual([]);
      expect(romLog()).toEqual([expect.objectContaining({ outcome: "continue" })]);
    });

    it("moves to the newly chosen engine instead of being skipped when the listener changes where it plays", async () => {
      connectionState.current = "DEMO_ACTIVE";
      localStorage.setItem("c64u_playback_engine", "local");
      const controller = fakeController();
      const decide = vi.fn(async () => "play-anyway" as const);
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller, { decide });
      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });
      expect(controller.play).toHaveBeenCalledTimes(1);

      await act(async () => {
        savePlaybackEngine("c64");
      });

      await waitFor(() => expect(controller.play).toHaveBeenCalledTimes(2));
      expect(decide).toHaveBeenCalledTimes(1);
      expect(skipNotices()).toEqual([]);
      expect(result.current.isPlaying).toBe(true);
    });
  });

  describe("moving on away from the C64", () => {
    it("after passing over a song on Next, moves past a track only the C64 can play too", async () => {
      const controller = fakeController();
      const playlist = [plain("a"), listed("b", 1), program("c"), plain("d")];
      const { result } = renderController(playlist, controller);
      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      await act(async () => {
        await result.current.handleNext("user");
      });

      expect(result.current.currentIndex).toBe(3);
      expect(controller.play).toHaveBeenCalledTimes(2);
      expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
    });

    it("warms the opening of the song that will play next, not of the one it will pass over", async () => {
      const controller = fakeController();
      const playlist = [plain("a"), listed("b", 1), plain("c")];
      const { result } = renderController(playlist, controller);

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      await waitFor(() => expect(controller.warmLeadIn).toHaveBeenCalledTimes(1));
      expect(controller.warmLeadIn).toHaveBeenCalledWith(
        expect.stringContaining("c"),
        expect.any(ArrayBuffer),
        0,
        expect.any(Number),
      );
      expect(controller.warmLeadIn).not.toHaveBeenCalledWith(
        expect.stringContaining("b"),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it("warms the listed neighbour as usual when a C64 is there to play it", async () => {
      connectionState.current = "REAL_CONNECTED";
      localStorage.setItem("c64u_local_engine_enabled", "1");
      localStorage.setItem("c64u_playback_engine", "local");
      const controller = fakeController();
      const playlist: PlaylistItem[] = [plain("a"), listed("b", 1)];
      const { result } = renderController(playlist, controller);

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      await waitFor(() => expect(controller.warmLeadIn).toHaveBeenCalledTimes(1));
      expect(controller.warmLeadIn).toHaveBeenCalledWith(
        expect.stringContaining("b"),
        expect.any(ArrayBuffer),
        0,
        expect.any(Number),
      );
    });
  });

  describe("ROM images that match no measured configuration", () => {
    it("judges a song by the lowest grade of the four lanes and says so in the log", async () => {
      storedRoms.current = { kernal: new Uint8Array(8192), basic: FAKE_ROMS.basic };
      const controller = fakeController();
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller);

      await attempt(() => result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto" }));

      expect(controller.play).not.toHaveBeenCalled();
      expect(romLog()).toEqual([
        expect.objectContaining({ basis: "list", lane: "sidliteNone", grade: 0, approximate: true, outcome: "skip" }),
      ]);
    });
  });
});
