/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { buildSid, c64Holding, KERNAL_IRQ } from "../../helpers/sidMemory";
import { isTuneStillPlayingOnC64 } from "@/lib/playback/tuneStillPlayingOnC64";

describe("telling whether the C64 still plays the tune the phone carried on", () => {
  it("finds the tune playing when its bytes are in place and a player holds the interrupt", async () => {
    const sid = buildSid();
    const c64 = c64Holding(sid);

    expect(await isTuneStillPlayingOnC64(c64, sid.buffer, 0)).toBe(true);
    expect(c64.readMemory).toHaveBeenCalledWith("1000", 2000);
    expect(c64.readMemory).toHaveBeenCalledWith("0314", 2);
  });

  it("finds the tune playing when it has changed some of its own bytes", async () => {
    const sid = buildSid({ magic: "RSID", loadInData: true });

    expect(await isTuneStillPlayingOnC64(c64Holding(sid, { changed: 100 }), sid.buffer, 0)).toBe(true);
  });

  it("does not find the tune when something else has been loaded over it", async () => {
    const sid = buildSid();
    const c64 = c64Holding(sid, { changed: 1000 });

    expect(await isTuneStillPlayingOnC64(c64, sid.buffer, 0)).toBe(false);
    expect(c64.readMemory).not.toHaveBeenCalledWith("0314", 2);
  });

  // Another tune by the same musician shares the player code; on a c64u, Chess II matched 86% of Chess's memory.
  it("does not find the tune when another tune with the same player plays", async () => {
    const sid = buildSid();

    expect(await isTuneStillPlayingOnC64(c64Holding(sid, { changed: 280 }), sid.buffer, 0)).toBe(false);
  });

  it("does not find the tune playing on a C64 that was reset with the tune still in memory", async () => {
    const sid = buildSid();
    const c64 = c64Holding(sid, { irq: KERNAL_IRQ });

    expect(await isTuneStillPlayingOnC64(c64, sid.buffer, 0)).toBe(false);
    expect(c64.readMemory).toHaveBeenCalledTimes(3);
  });

  it("finds a tune playing from the hardware vector, whose memory keeps changing", async () => {
    const sid = buildSid();
    const c64 = c64Holding(sid, { irq: KERNAL_IRQ });
    const read = c64.readMemory.getMockImplementation()!;
    c64.readMemory.mockImplementation(async (address, length) => {
      c64.memory[0x1010] += 1;
      return read(address, length);
    });

    expect(await isTuneStillPlayingOnC64(c64, sid.buffer, 0)).toBe(true);
  });

  it("finds a BASIC tune playing, although it runs from the KERNAL's interrupt", async () => {
    const sid = buildSid({ magic: "RSID", load: 0x0801, basic: true });
    const c64 = c64Holding(sid, { irq: KERNAL_IRQ });

    expect(await isTuneStillPlayingOnC64(c64, sid.buffer, 0)).toBe(true);
    expect(c64.readMemory).toHaveBeenCalledTimes(1);
  });

  it("compares only memory the Ultimate can always read when a tune lies under BASIC ROM", async () => {
    const sid = buildSid({ load: 0xb800, length: 0x1000 });
    const c64 = c64Holding(sid);
    // The CPU sees BASIC ROM at $A000-$BFFF most of the time, so a read there shows ROM, not the tune.
    c64.memory.fill(0x60, 0xb800, 0xc000);

    expect(await isTuneStillPlayingOnC64(c64, sid.buffer, 0)).toBe(true);
    expect(c64.readMemory).toHaveBeenCalledWith("C000", 0x800);
    expect(c64.readMemory).not.toHaveBeenCalledWith("B800", expect.anything());
  });

  it("reads a large tune in chunks and compares at most 16 KB of it", async () => {
    const sid = buildSid({ load: 0x0800, length: 0x6000 });
    const c64 = c64Holding(sid);

    expect(await isTuneStillPlayingOnC64(c64, sid.buffer, 0)).toBe(true);
    expect(c64.readMemory.mock.calls.filter(([address]) => address !== "0314")).toEqual([
      ["0800", 0x1000],
      ["1800", 0x1000],
      ["2800", 0x1000],
      ["3800", 0x1000],
    ]);
  });

  it("cannot tell from bytes that are not a SID file, or a tune entirely under ROM", async () => {
    const c64 = c64Holding({ tune: new Uint8Array(0), load: 0 });

    expect(await isTuneStillPlayingOnC64(c64, new TextEncoder().encode("not a sid file at all").buffer)).toBeNull();
    expect(await isTuneStillPlayingOnC64(c64, new Uint8Array(0x80).buffer)).toBeNull();
    expect(await isTuneStillPlayingOnC64(c64, buildSid({ load: 0xe000 }).buffer)).toBeNull();
    expect(c64.readMemory).not.toHaveBeenCalled();
  });
});
