/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { identify, isPluginAvailable, constructed, selectedGetInfo } = vi.hoisted(() => ({
  identify: vi.fn(),
  isPluginAvailable: vi.fn(() => true),
  constructed: [] as Array<{ baseUrl: string | undefined; password: string | undefined; host: string | undefined }>,
  selectedGetInfo: vi.fn(async () => ({ unique_id: "5D0464" })),
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isPluginAvailable } }));
vi.mock("@/lib/native/streamUdp", () => ({ StreamUdp: { identify } }));
vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ getInfo: selectedGetInfo }),
  C64API: class {
    constructor(baseUrl?: string, password?: string, host?: string) {
      constructed.push({ baseUrl, password, host });
    }
    async getInfo() {
      return { unique_id: "5D0464" };
    }
  },
}));

import { addLog } from "@/lib/logging";
import { isSelectedDeviceSender } from "@/lib/streams/sameDeviceSender";

const ids: Record<string, string | null> = {
  c64u: "5D0464",
  "192.0.2.46": "5D0464",
  "198.51.100.13": "8A7F21",
  "192.0.2.50": null,
};
const lookup = async (host: string) => ids[host] ?? null;
const deps = { senderUniqueId: lookup, selectedUniqueId: lookup };

describe("isSelectedDeviceSender", () => {
  beforeEach(() => {
    identify.mockReset();
    isPluginAvailable.mockReturnValue(true);
    constructed.length = 0;
  });

  it("recognizes the selected device streaming from its other network address", async () => {
    expect(await isSelectedDeviceSender("192.0.2.46", "c64u", deps)).toBe(true);
  });

  it("does not take another Ultimate, or one that reports no id, for the selected device", async () => {
    expect(await isSelectedDeviceSender("198.51.100.13", "c64u", deps)).toBe(false);
    expect(await isSelectedDeviceSender("192.0.2.50", "c64u", deps)).toBe(false);
  });

  it("logs and answers no when the sender cannot be asked", async () => {
    const unreachable = async () => {
      throw new Error("timeout");
    };
    expect(await isSelectedDeviceSender("192.0.2.46", "c64u", { ...deps, senderUniqueId: unreachable })).toBe(false);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Live View: could not tell whether a stream sender is the selected device",
      expect.objectContaining({ source: "192.0.2.46", error: "timeout" }),
    );
  });

  it("asks the sender over ident, so the selected device's password is not sent to it", async () => {
    identify.mockResolvedValue({ uniqueId: "5D0464", replyFrom: "192.0.2.47" });

    expect(await isSelectedDeviceSender("192.0.2.46", "c64u")).toBe(true);

    expect(identify).toHaveBeenCalledWith({ host: "192.0.2.46", timeoutMs: 1500 });
    expect(constructed).toEqual([]);
  });

  it("falls back to a REST lookup that carries no password when ident does not answer", async () => {
    identify.mockResolvedValue({ uniqueId: null, replyFrom: null });

    expect(await isSelectedDeviceSender("192.0.2.46", "c64u")).toBe(true);

    expect(constructed).toEqual([{ baseUrl: "http://192.0.2.46", password: undefined, host: "192.0.2.46" }]);
  });
});
