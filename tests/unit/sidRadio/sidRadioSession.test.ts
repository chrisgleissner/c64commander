/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSidRadioSession,
  loadSidRadioSession,
  saveSidRadioSession,
  type SidRadioSessionDescriptor,
} from "@/lib/sidRadio/sidRadioSession";

const descriptor: SidRadioSessionDescriptor = {
  seedKind: "song",
  seedLabel: "Commando",
  seed: { kind: "song", md5_48: "aabbccddeeff" },
  styleFilter: null,
  shuffleSeed: 12345,
  rankingSnapshotId: "abc123",
  excludeOrdinals: [1, 2, 3, 7],
};

beforeEach(() => localStorage.clear());

describe("sidRadioSession", () => {
  it("round-trips the descriptor (exact recompute tuple, D15)", () => {
    saveSidRadioSession(descriptor);
    expect(loadSidRadioSession()).toEqual(descriptor);
  });

  it("returns null when nothing is saved", () => {
    expect(loadSidRadioSession()).toBeNull();
  });

  it("clears the saved session", () => {
    saveSidRadioSession(descriptor);
    clearSidRadioSession();
    expect(loadSidRadioSession()).toBeNull();
  });

  it("rejects a malformed / partial record", () => {
    localStorage.setItem("c64u_sid_radio_session", JSON.stringify({ seedKind: "song" }));
    expect(loadSidRadioSession()).toBeNull();
  });
});
