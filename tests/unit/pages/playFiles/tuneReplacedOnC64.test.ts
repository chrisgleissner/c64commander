/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSid, c64Holding, KERNAL_IRQ } from "../../../helpers/sidMemory";
import type { PlaylistItem } from "@/pages/playFiles/types";

const c64 = { current: null as ReturnType<typeof c64Holding> | null };
const connection = { state: "REAL_CONNECTED" };
const network = { offline: false };
const sidBytes = { current: null as ArrayBuffer | null };

vi.mock("@/lib/c64api", () => ({ getC64API: () => c64.current }));
vi.mock("@/lib/connection/connectionManager", () => ({ getConnectionSnapshot: () => connection }));
vi.mock("@/lib/connection/networkStatusWatch", () => ({ isNetworkKnownOffline: () => network.offline }));
vi.mock("@/pages/playFiles/readSidBytes", () => ({ readSidBytes: vi.fn(async () => sidBytes.current) }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import { readSidBytes } from "@/pages/playFiles/readSidBytes";
import { isTuneReplacedOnC64, TUNE_REPLACED_CHECK_TIMEOUT_MS } from "@/pages/playFiles/tuneReplacedOnC64";

const SID_LENGTH = 2000;
const sidItem = { id: "one", label: "one.sid", category: "sid", path: "/one.sid", request: {} } as PlaylistItem;
const resolveHvsc = vi.fn(async () => null);
const replaced = () => isTuneReplacedOnC64(sidItem, resolveHvsc);

/** A C64 whose memory at the tune's load address holds `matching` of the tune's own bytes. */
const holdingShare = (matching: number, options: { irq?: number[] } = {}) => {
  const sid = buildSid({ length: SID_LENGTH });
  sidBytes.current = sid.buffer;
  c64.current = c64Holding(sid, options);
  const changed = Math.round(SID_LENGTH * (1 - matching));
  for (let index = 0; index < changed; index += 1) c64.current.memory[sid.load + index] ^= 0xff;
  return c64.current;
};

describe("telling whether the C64 plays something other than this phone's tune", () => {
  beforeEach(() => {
    connection.state = "REAL_CONNECTED";
    network.offline = false;
    vi.mocked(addLog).mockClear();
    vi.mocked(readSidBytes).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("finds the tune replaced when the C64's memory holds another tune", async () => {
    holdingShare(0.2);
    expect(await replaced()).toBe(true);
  });

  it("does not find the tune replaced while it plays", async () => {
    holdingShare(1);
    expect(await replaced()).toBe(false);
  });

  // Between the 90% that proves a tune plays and the 50% that proves another one does, the playlist goes on.
  it("keeps the playlist going when the memory only partly matches the tune", async () => {
    holdingShare(0.7);
    expect(await replaced()).toBe(false);
  });

  it("finds the tune replaced on a C64 that was reset with the tune still in memory", async () => {
    holdingShare(1, { irq: KERNAL_IRQ });
    expect(await replaced()).toBe(true);
  });

  it("does not ask a C64 it is not connected to", async () => {
    const memory = holdingShare(0.2);
    connection.state = "DISCONNECTED";
    expect(await replaced()).toBe(false);
    expect(readSidBytes).not.toHaveBeenCalled();
    expect(memory.readMemory).not.toHaveBeenCalled();
  });

  it("does not ask the C64 while the phone has no network", async () => {
    const memory = holdingShare(0.2);
    network.offline = true;
    expect(await replaced()).toBe(false);
    expect(memory.readMemory).not.toHaveBeenCalled();
  });

  it("does not ask about anything but a SID", async () => {
    holdingShare(0.2);
    expect(await isTuneReplacedOnC64({ ...sidItem, category: "prg" }, resolveHvsc)).toBe(false);
    expect(readSidBytes).not.toHaveBeenCalled();
  });

  it("moves on as before, with a warning, when the C64's memory cannot be read", async () => {
    holdingShare(0.2).readMemory.mockRejectedValue(new Error("HTTP 503"));
    expect(await replaced()).toBe(false);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("could not check whether the C64 still plays"),
      expect.objectContaining({ error: "HTTP 503" }),
    );
  });

  it("moves on as before when the tune's bytes cannot be read", async () => {
    holdingShare(0.2);
    sidBytes.current = null;
    expect(await replaced()).toBe(false);
  });

  it("gives up and moves on as before when the C64 does not answer in time", async () => {
    vi.useFakeTimers();
    holdingShare(0.2).readMemory.mockImplementation(() => new Promise(() => undefined));
    const verdict = replaced();
    await vi.advanceTimersByTimeAsync(TUNE_REPLACED_CHECK_TIMEOUT_MS);
    expect(await verdict).toBe(false);
    expect(addLog).toHaveBeenCalledWith("warn", expect.any(String), expect.objectContaining({ item: "one.sid" }));
  });
});
