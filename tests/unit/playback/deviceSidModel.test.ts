/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { C64API } from "@/lib/c64api";
import { readDeviceSidModel, syncDeviceSidModel } from "@/lib/playback/deviceSidModel";
import { loadLearnedDeviceSidModel, saveLearnedDeviceSidModel } from "@/lib/config/appSettings";

/**
 * The payloads below are verbatim `GET /v1/configs/...` responses from a C64U Starlight Edition on
 * firmware 1.1.0, captured while this was written. That machine has an ARMSID in each socket, set
 * to a different revision each — socket 1 to 6581 and socket 2 to 8580 — which is what makes the
 * "which socket counts" decision testable rather than theoretical.
 */
const SOCKETS_ARMSID_PAIR = {
  "SID Sockets Configuration": {
    "SID Socket 1": "Enabled",
    "SID Socket 2": "Enabled",
    "SID Detected Socket 1": "ARMSID",
    "SID Detected Socket 2": "ARMSID",
    "SID Socket 1 1K Ohm Resistor": "Off",
    "SID Socket 2 1K Ohm Resistor": "Off",
    "SID Socket 1 Capacitors": "470 pF",
    "SID Socket 2 Capacitors": "470 pF",
  },
  errors: [],
};

const ARMSID_DETAIL = (socket: 1 | 2, mode: "6581" | "8580") => ({
  [`SID Socket ${socket}: ARMSID`]: {
    "Fundamental Mode": mode,
    "6581 Filter Strength": "Average",
    "6581 Lowest Filt Freq": "215",
    "8580 Highest Filt Freq": "6 kHz",
    "8580 Lowest Filt Freq": "  30",
  },
  errors: [],
});

/** A socket holding a genuine chip: the firmware names the revision in the detected value itself. */
const socketsWith = (overrides: Record<string, string>) => ({
  "SID Sockets Configuration": {
    "SID Socket 1": "Disabled",
    "SID Socket 2": "Disabled",
    "SID Detected Socket 1": "None",
    "SID Detected Socket 2": "None",
    ...overrides,
  },
  errors: [],
});

type CategoryMap = Record<string, unknown>;

const notFound = () => Object.assign(new Error("Not Found"), { c64uHttpStatus: 404 });

const fakeApi = (categories: CategoryMap) => {
  const getCategory = vi.fn(async (category: string) => {
    if (!(category in categories)) throw notFound();
    return categories[category] as never;
  });
  return { api: { getCategory } as unknown as C64API, getCategory };
};

beforeEach(() => {
  localStorage.clear();
});

describe("readDeviceSidModel", () => {
  it("takes socket 1's chip when both sockets hold one", async () => {
    const { api } = fakeApi({
      "SID Sockets Configuration": SOCKETS_ARMSID_PAIR,
      "SID Socket 1: ARMSID": ARMSID_DETAIL(1, "6581"),
      "SID Socket 2: ARMSID": ARMSID_DETAIL(2, "8580"),
    });
    // Socket 1 is the machine's primary SID — the chip a single-chip tune reaches — so it wins
    // even though socket 2 answers just as definitely.
    await expect(readDeviceSidModel(api)).resolves.toEqual({ model: "6581", source: "SID Socket 1" });
  });

  it("falls through to socket 2 when socket 1 is switched off", async () => {
    const { api } = fakeApi({
      "SID Sockets Configuration": {
        "SID Sockets Configuration": {
          ...SOCKETS_ARMSID_PAIR["SID Sockets Configuration"],
          "SID Socket 1": "Disabled",
        },
        errors: [],
      },
      "SID Socket 1: ARMSID": ARMSID_DETAIL(1, "6581"),
      "SID Socket 2: ARMSID": ARMSID_DETAIL(2, "8580"),
    });
    await expect(readDeviceSidModel(api)).resolves.toEqual({ model: "8580", source: "SID Socket 2" });
  });

  it("skips a socket that is switched off even when its chip is detected", async () => {
    const { api } = fakeApi({
      "SID Sockets Configuration": socketsWith({
        // The chip is in the socket and the firmware can see it, but the socket is switched out of
        // the audio path — so it says nothing about what this machine sounds like.
        "SID Socket 1": "Disabled",
        "SID Detected Socket 1": "6581",
        "SID Socket 2": "Enabled",
        "SID Detected Socket 2": "8580",
      }),
    });
    await expect(readDeviceSidModel(api)).resolves.toEqual({ model: "8580", source: "SID Socket 2" });
  });

  it("reads a genuine chip straight from the detected value, without a second request", async () => {
    const { api, getCategory } = fakeApi({
      "SID Sockets Configuration": socketsWith({ "SID Socket 1": "Enabled", "SID Detected Socket 1": "8580" }),
    });
    await expect(readDeviceSidModel(api)).resolves.toEqual({ model: "8580", source: "SID Socket 1" });
    expect(getCategory).toHaveBeenCalledTimes(1);
  });

  it("returns nothing when neither socket holds a chip", async () => {
    const { api } = fakeApi({ "SID Sockets Configuration": socketsWith({}) });
    // An Ultimate with empty sockets plays through its FPGA SIDs, whose character is spread over
    // filter curve, resonance, combined waveforms and digis level and can name two revisions at
    // once. There is no honest single answer, so the user's own choice stands.
    await expect(readDeviceSidModel(api)).resolves.toBeNull();
  });

  it("survives a firmware that does not publish the per-socket category", async () => {
    const { api } = fakeApi({
      "SID Sockets Configuration": socketsWith({
        "SID Socket 1": "Enabled",
        "SID Detected Socket 1": "SidFx",
        "SID Socket 2": "Enabled",
        "SID Detected Socket 2": "6581",
      }),
    });
    await expect(readDeviceSidModel(api)).resolves.toEqual({ model: "6581", source: "SID Socket 2" });
  });
});

describe("syncDeviceSidModel", () => {
  it("remembers what it read", async () => {
    const { api } = fakeApi({
      "SID Sockets Configuration": SOCKETS_ARMSID_PAIR,
      "SID Socket 1: ARMSID": ARMSID_DETAIL(1, "6581"),
      "SID Socket 2: ARMSID": ARMSID_DETAIL(2, "8580"),
    });
    await syncDeviceSidModel(api);
    expect(loadLearnedDeviceSidModel()).toBe("6581");
  });

  it("keeps the previously learned chip when the device cannot be reached", async () => {
    saveLearnedDeviceSidModel("6581");
    const api = {
      getCategory: vi.fn(async () => {
        throw new Error("Host unreachable");
      }),
    } as unknown as C64API;
    await expect(syncDeviceSidModel(api)).resolves.toBeNull();
    expect(loadLearnedDeviceSidModel()).toBe("6581");
  });

  it("keeps the previously learned chip when the machine has nothing to report", async () => {
    saveLearnedDeviceSidModel("6581");
    const { api } = fakeApi({ "SID Sockets Configuration": socketsWith({}) });
    await expect(syncDeviceSidModel(api)).resolves.toBeNull();
    expect(loadLearnedDeviceSidModel()).toBe("6581");
  });
});
