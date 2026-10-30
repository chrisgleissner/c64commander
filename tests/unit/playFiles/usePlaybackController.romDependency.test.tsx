/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Songs the ROM dependency list says sound different on this phone: what the play path does with
 * them. The list is the synthetic fixture (see tests/helpers/romDependencyFixture.ts); in it
 * `synthetic.sid` grades below the threshold (128) in subtune 1 without ROMs, in subtune 2 with KERNAL
 * and BASIC, and exactly at the threshold (so it plays) in subtune 3 without ROMs.
 */

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlayPlan } from "@/lib/playback/playbackRouter";
import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { toast } from "@/hooks/use-toast";
import { ensureSystemRoms } from "@/lib/roms/ensureSystemRoms";
import { addErrorLog } from "@/lib/logging";
import { setRomDependencyAssetsForTests } from "@/lib/romDependency/embeddedRomDependencyList";
import { RomDependentSongSkipped } from "@/lib/romDependency/romDependencyPolicy";
import { romListedSkippedNotice } from "@/pages/playFiles/romDependencyGate";
import { resetRomSkipNoticeForTests } from "@/pages/playFiles/resolveLocalRoute";
import { ENGINE_FALLBACK_MESSAGES } from "@/lib/playback/playbackEngineRouting";
import { FAKE_ROMS, syntheticAssets, SYNTHETIC_SID_MD5 } from "../../helpers/romDependencyFixture";
import { attempt, fakeController, listed, plain, renderController } from "../../helpers/romDependencyController";

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
vi.mock("@/lib/c64api", () => ({ getC64API: vi.fn(() => ({})) }));
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

describe("ROM dependency list in the play path", () => {
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

  describe("autoplay, radio and auto-advance (default: skip)", () => {
    it("passes over a listed song and plays the next one, saying why once", async () => {
      const controller = fakeController();
      const playlist = [plain("a"), listed("b", 1), listed("c", 1), plain("d")];
      const { result } = renderController(playlist, controller);

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });
      await act(async () => {
        await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
      });

      // Both listed songs are passed over; the plain one after them plays.
      expect(controller.play).toHaveBeenCalledTimes(2);
      expect(result.current.currentIndex).toBe(3);
      expect(result.current.isPlaying).toBe(true);
      expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
      const skipNotices = toastDescriptions().filter((text) => text?.startsWith("Skipped"));
      expect(skipNotices).toEqual([romListedSkippedNotice("Listed b")]);
    });

    it("skips on a SID Radio station exactly as in a playlist", async () => {
      const controller = fakeController();
      const playlist = [plain("a"), listed("b", 1), plain("c")];
      const { result } = renderController(playlist, controller, { station: true });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });
      await act(async () => {
        await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
      });

      expect(result.current.currentIndex).toBe(2);
      expect(controller.play).toHaveBeenCalledTimes(2);
    });

    it("ends the playlist when nothing after the listed songs can play", async () => {
      const controller = fakeController();
      const playlist = [plain("a"), listed("b", 1), listed("c", 1)];
      const { result } = renderController(playlist, controller);

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });
      await act(async () => {
        await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
      });

      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(result.current.isPlaying).toBe(false);
    });

    it("rejects a listed song launched by auto-advance with a skip, not an error", async () => {
      const controller = fakeController();
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller);

      expect(
        await attempt(() => result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto" })),
      ).toBeInstanceOf(RomDependentSongSkipped);
      expect(controller.play).not.toHaveBeenCalled();
    });

    it("does not skip the other subtunes of a listed file", async () => {
      const controller = fakeController();
      const playlist = [listed("b2", 2), listed("b4", 4)];
      const { result } = renderController(playlist, controller);

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto" });
        await result.current.playItem(playlist[1], { playlistIndex: 1, origin: "auto" });
      });

      expect(controller.play).toHaveBeenCalledTimes(2);
    });
  });

  describe("Next and Previous", () => {
    it("pass over listed songs like auto-advance, without asking, and say why once", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [plain("a"), listed("b", 1), listed("c", 1), plain("d")];
      const { result } = renderController(playlist, controller, { decide });
      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      await act(async () => {
        await result.current.handleNext("user");
      });

      expect(result.current.currentIndex).toBe(3);

      expect(decide).not.toHaveBeenCalled();
      expect(controller.play).toHaveBeenCalledTimes(2);
      expect(toastDescriptions().filter((text) => text?.startsWith("Skipped"))).toHaveLength(1);
    });

    it("end the playlist when every song after the current one is passed over", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [plain("a"), listed("b", 1), listed("c", 1)];
      const { result } = renderController(playlist, controller, { decide });
      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      await act(async () => {
        await result.current.handleNext("user");
      });

      expect(decide).not.toHaveBeenCalled();
      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(result.current.isPlaying).toBe(false);
      expect(toastDescriptions().filter((text) => text?.startsWith("Skipped"))).toHaveLength(1);
    });

    it("pass over a listed song going back, to the previous one that can play", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [plain("a"), listed("b", 1), plain("c")];
      const { result } = renderController(playlist, controller, { decide });
      await act(async () => {
        await result.current.playItem(playlist[2], { playlistIndex: 2 });
      });

      await act(async () => {
        await result.current.handlePrevious();
      });

      expect(result.current.currentIndex).toBe(0);

      expect(decide).not.toHaveBeenCalled();
      expect(controller.play).toHaveBeenCalledTimes(2);
    });
  });

  describe("a song the listener chooses", () => {
    it("asks first, and plays it here when the answer is Play anyway", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "play-anyway" as const);
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      expect(decide).toHaveBeenCalledWith(playlist[0]);
      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
    });

    it("does not play it when the answer is Cancel, and leaves what was sounding playing", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [plain("a"), listed("b", 1)];
      const { result } = renderController(playlist, controller, { decide });
      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });
      controller.play.mockClear();

      expect(await attempt(() => result.current.playItem(playlist[1], { playlistIndex: 1 }))).toBeUndefined();

      expect(controller.play).not.toHaveBeenCalled();
      expect(controller.stop).not.toHaveBeenCalled();
      expect(result.current.isPlaying).toBe(true);
      expect(result.current.currentIndex).toBe(0);
    });

    it("does not play it when nothing is there to ask", async () => {
      const controller = fakeController();
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller);

      expect(await attempt(() => result.current.playItem(playlist[0], { playlistIndex: 0 }))).toBeUndefined();
      expect(controller.play).not.toHaveBeenCalled();
      expect(result.current.isPlaying).toBe(false);
    });

    it("does not ask about a song the list does not name", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [plain("a")];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      expect(decide).not.toHaveBeenCalled();
      expect(controller.play).toHaveBeenCalledTimes(1);
    });
  });

  describe("Settings → Play and disk → Skip songs that need the C64 ROMs, turned off", () => {
    beforeEach(() => localStorage.setItem("c64u_skip_rom_dependent_songs", "0"));

    it("plays a listed song moving on by itself, with a short notice", async () => {
      const controller = fakeController();
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller);

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto" });
      });

      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(toastDescriptions()).toContain(ENGINE_FALLBACK_MESSAGES["rom-list-played-anyway"]);
    });

    it("plays a chosen listed song without asking", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      expect(decide).not.toHaveBeenCalled();
      expect(controller.play).toHaveBeenCalledTimes(1);
    });
  });

  describe("with a C64 connected", () => {
    beforeEach(() => {
      connectionState.current = "REAL_CONNECTED";
      localStorage.setItem("c64u_local_engine_enabled", "1");
      localStorage.setItem("c64u_playback_engine", "local");
    });

    it("plays the listed song on the C64, with the existing ROM notice, and never skips or asks", async () => {
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto" });
      });
      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      expect(controller.play).not.toHaveBeenCalled();
      expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(2);
      expect(decide).not.toHaveBeenCalled();
      expect(toastDescriptions()).toContain(ENGINE_FALLBACK_MESSAGES["rom-on-c64"]);
      // The C64 is there, so the ROMs are worth reading from it for the songs that follow.
      expect(ensureSystemRoms).toHaveBeenCalled();
    });

    it("does the same when skipping is turned off", async () => {
      localStorage.setItem("c64u_skip_rom_dependent_songs", "0");
      const controller = fakeController();
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller);

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      expect(controller.play).not.toHaveBeenCalled();
      expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
    });

    it("leaves an unlisted song on the phone", async () => {
      const controller = fakeController();
      const playlist = [plain("a")];
      const { result } = renderController(playlist, controller);

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
    });

    it("does nothing when playback is set to the C64: the list is for the phone's own emulation", async () => {
      localStorage.setItem("c64u_playback_engine", "c64");
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto" });
      });

      expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
      expect(decide).not.toHaveBeenCalled();
      expect(toastDescriptions().filter((text) => text?.startsWith("Skipped"))).toEqual([]);
    });

    it("goes to the C64 even with KERNAL and BASIC stored, when the list says that is not enough", async () => {
      storedRoms.current = { kernal: FAKE_ROMS.kernal, basic: FAKE_ROMS.basic };
      const controller = fakeController();
      const playlist = [listed("b", 2)];
      const { result } = renderController(playlist, controller);

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      expect(controller.play).not.toHaveBeenCalled();
      expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
      expect(toastDescriptions()).toContain(ENGINE_FALLBACK_MESSAGES["rom-list-on-c64"]);
    });
  });

  describe("configurations the list does not restrict", () => {
    it("restricts nothing in the reference configuration (all three authentic ROMs)", async () => {
      storedRoms.current = { kernal: FAKE_ROMS.kernal, basic: FAKE_ROMS.basic, chargen: FAKE_ROMS.chargen };
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [listed("b1", 1), listed("b2", 2)];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto" });
        await result.current.playItem(playlist[1], { playlistIndex: 1 });
      });

      expect(controller.play).toHaveBeenCalledTimes(2);
      expect(decide).not.toHaveBeenCalled();
    });

    it("uses the KERNAL + BASIC measurements when those ROMs are stored: subtune 1 plays, subtune 2 is skipped", async () => {
      storedRoms.current = { kernal: FAKE_ROMS.kernal, basic: FAKE_ROMS.basic };
      const controller = fakeController();
      const playlist = [listed("b1", 1), listed("b2", 2)];
      const { result } = renderController(playlist, controller);

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto" });
      });
      expect(
        await attempt(() => result.current.playItem(playlist[1], { playlistIndex: 1, origin: "auto" })),
      ).toBeInstanceOf(RomDependentSongSkipped);
      expect(controller.play).toHaveBeenCalledTimes(1);
    });

    it("plays a song graded exactly at the threshold, with no skip, question or notice, however it is started", async () => {
      // synthetic.sid subtune 3 grades 128 in the SIDLite no-ROMs configuration; the list's threshold is 128.
      const controller = fakeController();
      const decide = vi.fn(async () => "cancel" as const);
      const playlist = [listed("b3", 3)];
      const { result } = renderController(playlist, controller, { decide });

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto" });
        await result.current.playItem(playlist[0], { playlistIndex: 0 });
      });

      expect(controller.play).toHaveBeenCalledTimes(2);
      expect(decide).not.toHaveBeenCalled();
      expect(toastDescriptions().filter((text) => text?.includes("ROM"))).toEqual([]);
    });
  });

  describe("when the list cannot be trusted", () => {
    it("plays the song, and logs the error, instead of failing", async () => {
      setRomDependencyAssetsForTests(async () => {
        throw new Error("chunk failed to load");
      });
      const controller = fakeController();
      const playlist = [listed("b", 1)];
      const { result } = renderController(playlist, controller);

      await act(async () => {
        await result.current.playItem(playlist[0], { playlistIndex: 0, origin: "auto" });
      });

      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(addErrorLog).toHaveBeenCalledWith(
        "SID ROM dependency list rejected; playing without it",
        expect.objectContaining({ error: "chunk failed to load" }),
      );
      expect(SYNTHETIC_SID_MD5).toHaveLength(32);
    });
  });
});
