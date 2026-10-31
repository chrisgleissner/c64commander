/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  autoRoms: vi.fn(() => true),
  skipEnabled: vi.fn(() => true),
  romsReady: vi.fn(() => true),
  romRequired: vi.fn(() => false),
  assess: vi.fn(),
  ensureSystemRoms: vi.fn(),
  promptForSystemRoms: vi.fn(),
  probe: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/config/appSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/appSettings")>()),
  loadLocalEngineAutoRoms: mocks.autoRoms,
}));
vi.mock("@/lib/config/romDependencySettings", () => ({ loadSkipRomDependentSongs: mocks.skipEnabled }));
vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));
vi.mock("@/lib/playback/renderedTuneCache", () => ({ playbackSidEmulation: () => "sidlite" }));
vi.mock("@/lib/playback/sidRenderer/sidRendererAvailability", () => ({ probeSidRenderers: mocks.probe }));
vi.mock("@/lib/playback/localSidWorkerCore", () => ({ detectRomRequired: mocks.romRequired }));
vi.mock("@/lib/roms/ensureSystemRoms", () => ({ ensureSystemRoms: mocks.ensureSystemRoms }));
vi.mock("@/lib/roms/promptForSystemRoms", () => ({ promptForSystemRoms: mocks.promptForSystemRoms }));
vi.mock("@/lib/roms/romStore", () => ({ hasCompleteRomSet: mocks.romsReady }));
vi.mock("@/lib/romDependency/romDependencyPolicy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/romDependency/romDependencyPolicy")>()),
  assessRomDependency: mocks.assess,
}));

import { addErrorLog, addLog } from "@/lib/logging";
import { RomDependentSongSkipped } from "@/lib/romDependency/romDependencyPolicy";
import {
  playPassingOver,
  resetRomSkipNoticeForTests,
  resolveLocalRoute,
  type LocalRouteInput,
} from "@/pages/playFiles/resolveLocalRoute";

const LOW = { kind: "low", lane: "sidliteNone", grade: 40, approximate: false } as const;

const input = (overrides: Partial<LocalRouteInput> = {}): LocalRouteInput => ({
  file: { arrayBuffer: async () => new ArrayBuffer(8) } as unknown as LocalRouteInput["file"],
  songNr: 2,
  label: "Comic Bakery",
  selectionNotice: null,
  noMachineForRoms: false,
  c64Usable: false,
  passOver: false,
  accepted: false,
  stillWanted: vi.fn(() => true),
  notify: vi.fn(),
  onDeclined: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRomSkipNoticeForTests();
  mocks.autoRoms.mockReturnValue(true);
  mocks.skipEnabled.mockReturnValue(true);
  mocks.romsReady.mockReturnValue(true);
  mocks.romRequired.mockReturnValue(false);
  mocks.assess.mockResolvedValue({ kind: "none" });
});

describe("resolveLocalRoute", () => {
  it("plays on the phone without a notice when the list has nothing against the song", async () => {
    const route = input();
    expect(await resolveLocalRoute(route)).toBe(true);
    expect(route.notify).not.toHaveBeenCalled();
    expect(mocks.assess).toHaveBeenCalledWith({ sidBytes: expect.any(Uint8Array), songNr: 2, engine: "sidlite" });
  });

  it("hands the song to the C64 and logs the error when the file cannot be read", async () => {
    const route = input({
      file: {
        arrayBuffer: async () => {
          throw new Error("file vanished");
        },
      } as unknown as LocalRouteInput["file"],
    });

    expect(await resolveLocalRoute(route)).toBe(false);

    expect(addErrorLog).toHaveBeenCalledWith("Local engine could not read the SID; using the C64", {
      error: "file vanished",
      stack: expect.stringContaining("file vanished"),
      item: "Comic Bakery",
    });
  });

  it("passes over a listed song when the playlist moves on by itself, telling the listener once per session", async () => {
    mocks.assess.mockResolvedValue(LOW);
    const route = input({ passOver: true });

    await expect(resolveLocalRoute(route)).rejects.toBeInstanceOf(RomDependentSongSkipped);
    await expect(resolveLocalRoute(route)).rejects.toBeInstanceOf(RomDependentSongSkipped);

    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Song skipped" }));
    expect(route.notify).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      "info",
      "Song needs the C64 ROMs on this device",
      expect.objectContaining({ item: "Comic Bakery", songNr: 2, lane: "sidliteNone", grade: 40, outcome: "skip" }),
    );
  });

  it("does not play a listed song the listener chose when they cancel, and reports the decline", async () => {
    mocks.assess.mockResolvedValue(LOW);
    const route = input({ ask: vi.fn(async () => "cancel" as const) });

    expect(await resolveLocalRoute(route)).toBeNull();

    expect(route.onDeclined).toHaveBeenCalledTimes(1);
    expect(route.notify).not.toHaveBeenCalled();
  });

  it("does not play a listed song the listener chose when nothing can ask them", async () => {
    mocks.assess.mockResolvedValue(LOW);
    const route = input();

    expect(await resolveLocalRoute(route)).toBeNull();

    expect(route.onDeclined).toHaveBeenCalledTimes(1);
  });

  it("plays a listed song on the phone, without repeating the warning, when the listener chooses to play anyway", async () => {
    mocks.assess.mockResolvedValue(LOW);
    const route = input({ ask: vi.fn(async () => "play-anyway" as const) });

    expect(await resolveLocalRoute(route)).toBe(true);

    expect(route.notify).not.toHaveBeenCalled();
    expect(route.onDeclined).not.toHaveBeenCalled();
  });

  it("drops a Play anyway that came after something overtook the song while the question was open", async () => {
    mocks.assess.mockResolvedValue(LOW);
    const route = input({ ask: vi.fn(async () => "play-anyway" as const), stillWanted: vi.fn(() => false) });

    expect(await resolveLocalRoute(route)).toBeNull();

    expect(route.stillWanted).toHaveBeenCalledTimes(1);
    expect(route.onDeclined).not.toHaveBeenCalled();
  });

  it("plays on, without a question, a skip or a notice, the song already accepted and started again", async () => {
    mocks.assess.mockResolvedValue(LOW);
    const ask = vi.fn(async () => "cancel" as const);
    const route = input({ passOver: true, accepted: true, ask });

    expect(await resolveLocalRoute(route)).toBe(true);

    expect(ask).not.toHaveBeenCalled();
    expect(route.notify).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("plays a listed song on the phone without asking when skipping is switched off", async () => {
    mocks.assess.mockResolvedValue(LOW);
    mocks.skipEnabled.mockReturnValue(false);
    const ask = vi.fn(async () => "cancel" as const);
    const route = input({ ask });

    expect(await resolveLocalRoute(route)).toBe(true);

    expect(ask).not.toHaveBeenCalled();
    expect(route.notify).toHaveBeenCalledWith("rom-list-played-anyway");
  });

  it("sends a listed song to the C64 when one is usable, reading the missing ROMs from it for later songs", async () => {
    mocks.assess.mockResolvedValue(LOW);
    mocks.romsReady.mockReturnValue(false);
    const route = input({ c64Usable: true });

    expect(await resolveLocalRoute(route)).toBe(false);

    expect(mocks.ensureSystemRoms).toHaveBeenCalledTimes(1);
    expect(route.notify).toHaveBeenCalledWith("rom-on-c64");
  });

  it("does not read ROMs from the C64 for a listed song when automatic reading is switched off", async () => {
    mocks.assess.mockResolvedValue(LOW);
    mocks.romsReady.mockReturnValue(false);
    mocks.autoRoms.mockReturnValue(false);

    expect(await resolveLocalRoute(input({ c64Usable: true }))).toBe(false);

    expect(mocks.ensureSystemRoms).not.toHaveBeenCalled();
  });

  it("does not read ROMs from the C64 for a listed song when the phone already has them", async () => {
    mocks.assess.mockResolvedValue(LOW);
    const route = input({ c64Usable: true });

    expect(await resolveLocalRoute(route)).toBe(false);

    expect(mocks.ensureSystemRoms).not.toHaveBeenCalled();
    expect(route.notify).toHaveBeenCalledWith("rom-list-on-c64");
  });

  it("goes straight to a usable C64 for a tune that declares a BASIC requirement the missing ROMs cannot satisfy", async () => {
    mocks.romRequired.mockReturnValue(true);
    mocks.romsReady.mockReturnValue(false);
    const route = input({ c64Usable: true });

    expect(await resolveLocalRoute(route)).toBe(false);

    expect(mocks.assess).not.toHaveBeenCalled();
    expect(route.notify).toHaveBeenCalledWith("rom-on-c64");
  });

  describe("a tune that declares BASIC, with BASIC missing and no usable C64", () => {
    beforeEach(() => {
      mocks.romRequired.mockReturnValue(true);
      mocks.romsReady.mockReturnValue(false);
    });

    it("counts the declared requirement as low fidelity when the list has no grade for it", async () => {
      const route = input({ passOver: true });

      await expect(resolveLocalRoute(route)).rejects.toBeInstanceOf(RomDependentSongSkipped);

      expect(addLog).toHaveBeenCalledWith(
        "info",
        "Song needs the C64 ROMs on this device",
        expect.objectContaining({ basis: "header", lane: null, grade: null, approximate: null, outcome: "skip" }),
      );
    });

    it("does not offer Play anyway when the listener chose it: it says what is missing and plays nothing", async () => {
      const ask = vi.fn(async () => "play-anyway" as const);
      const route = input({ ask });

      expect(await resolveLocalRoute(route)).toBeNull();

      expect(ask).toHaveBeenCalledTimes(1);
      expect(ask).toHaveBeenCalledWith("needs-basic");
      expect(route.onDeclined).toHaveBeenCalledTimes(1);
      expect(route.notify).not.toHaveBeenCalled();
    });

    it("does not play it, even with skipping switched off, and still has nothing to say when nothing can ask", async () => {
      mocks.skipEnabled.mockReturnValue(false);
      const route = input();

      expect(await resolveLocalRoute(route)).toBeNull();

      expect(route.onDeclined).toHaveBeenCalledTimes(1);
    });

    it("passes it over for a playlist moving on, even with skipping switched off", async () => {
      mocks.skipEnabled.mockReturnValue(false);

      await expect(resolveLocalRoute(input({ passOver: true }))).rejects.toBeInstanceOf(RomDependentSongSkipped);
    });

    it("still offers Play anyway for a tune the list grades low that declares no BASIC", async () => {
      mocks.romRequired.mockReturnValue(false);
      mocks.assess.mockResolvedValue(LOW);
      const ask = vi.fn(async () => "play-anyway" as const);

      expect(await resolveLocalRoute(input({ ask }))).toBe(true);

      expect(ask).toHaveBeenCalledWith("listed");
    });

    it("uses the list's grade for the lane in use, and says so in the log", async () => {
      mocks.assess.mockResolvedValue({ ...LOW, approximate: true });

      await expect(resolveLocalRoute(input({ passOver: true }))).rejects.toBeInstanceOf(RomDependentSongSkipped);

      expect(addLog).toHaveBeenCalledWith(
        "info",
        "Song needs the C64 ROMs on this device",
        expect.objectContaining({ basis: "list", lane: "sidliteNone", grade: 40, approximate: true }),
      );
    });

    it("still passes it over when the list grades it above the threshold without ROMs: the renderer refuses it without BASIC", async () => {
      mocks.assess.mockResolvedValue({ kind: "graded", lane: "sidliteNone", grade: 200, approximate: false });
      const ask = vi.fn(async () => "cancel" as const);
      const route = input({ passOver: true, ask, noMachineForRoms: true });

      await expect(resolveLocalRoute(route)).rejects.toBeInstanceOf(RomDependentSongSkipped);

      expect(ask).not.toHaveBeenCalled();
    });
  });

  describe("without the ROMs, for a song the list does not mention", () => {
    beforeEach(() => mocks.romsReady.mockReturnValue(false));

    it("plays on the phone and reads the ROMs from the machine in the background", async () => {
      const route = input();
      expect(await resolveLocalRoute(route)).toBe(true);
      expect(mocks.ensureSystemRoms).toHaveBeenCalledTimes(1);
      expect(route.notify).toHaveBeenCalledWith("rom-lite-engine");
    });

    it("asks the listener to turn automatic reading back on when they switched it off", async () => {
      mocks.autoRoms.mockReturnValue(false);
      expect(await resolveLocalRoute(input())).toBe(true);
      expect(mocks.promptForSystemRoms).toHaveBeenCalledTimes(1);
      expect(mocks.ensureSystemRoms).not.toHaveBeenCalled();
    });

    it("neither reads nor asks when there is no machine to read them from", async () => {
      expect(await resolveLocalRoute(input({ noMachineForRoms: true }))).toBe(true);
      expect(mocks.ensureSystemRoms).not.toHaveBeenCalled();
      expect(mocks.promptForSystemRoms).not.toHaveBeenCalled();
    });

    it("explains the engine choice instead when it was overridden", async () => {
      const route = input({ selectionNotice: "simulated-device-local-sid" });
      await resolveLocalRoute(route);
      expect(route.notify).toHaveBeenCalledWith("simulated-device-local-sid");
      expect(route.notify).not.toHaveBeenCalledWith("rom-lite-engine");
    });
  });
});

describe("playPassingOver", () => {
  const nextOf = (order: Array<number | null>) => (index: number) => order[index] ?? null;

  it("plays the first song when nothing is passed over", async () => {
    const play = vi.fn(async () => undefined);
    expect(await playPassingOver(0, play, nextOf([1, 2]))).toBe(true);
    expect(play.mock.calls).toEqual([[0]]);
  });

  it("moves on to the next song for each one passed over, and stops at the first that plays", async () => {
    const play = vi.fn(async (index: number) => {
      if (index < 2) throw new RomDependentSongSkipped(`song ${index}`);
    });
    expect(await playPassingOver(0, play, nextOf([1, 2, 3, 4]))).toBe(true);
    expect(play.mock.calls).toEqual([[0], [1], [2]]);
  });

  it("reports nothing left to play when the walk ends", async () => {
    const play = vi.fn(async (index: number) => {
      throw new RomDependentSongSkipped(`song ${index}`);
    });
    expect(await playPassingOver(0, play, nextOf([1, null]))).toBe(false);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("stops when the walk comes back to a song already passed over", async () => {
    const play = vi.fn(async (index: number) => {
      throw new RomDependentSongSkipped(`song ${index}`);
    });
    expect(await playPassingOver(0, play, nextOf([1, 0]))).toBe(false);
    expect(play.mock.calls).toEqual([[0], [1]]);
  });

  it("logs each song it passes over", async () => {
    const play = vi.fn(async (index: number) => {
      if (index === 0) throw new RomDependentSongSkipped("song 0");
    });
    await playPassingOver(0, play, nextOf([1]));
    expect(addLog).toHaveBeenCalledWith("debug", "Passed over a song that needs the C64 ROMs", {
      index: 0,
      error: "song 0 needs the C64 ROMs and was skipped",
    });
  });

  it("does not swallow any other failure", async () => {
    const play = vi.fn(async () => {
      throw new Error("device offline");
    });
    await expect(playPassingOver(0, play, nextOf([1]))).rejects.toThrow("device offline");
    expect(play).toHaveBeenCalledTimes(1);
  });
});
