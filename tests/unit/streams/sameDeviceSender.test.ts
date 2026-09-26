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
  selectedGetInfo: vi.fn(async () => ({ unique_id: "5D0464", hostname: "c64u" })),
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
      return { unique_id: "5D0464", hostname: "c64u" };
    }
  },
}));

import { addLog } from "@/lib/logging";
import { compareMachineIdentities, judgeStreamSender, type MachineIdentity } from "@/lib/streams/sameDeviceSender";

const machines: Record<string, MachineIdentity> = {
  c64u: { uniqueId: "5d0464", hostname: "c64u" },
  "192.0.2.46": { uniqueId: "5d0464", hostname: "c64u" },
  "198.51.100.13": { uniqueId: "8a7f21", hostname: "ultimate-64-elite-f83c87" },
  "198.51.100.14": { uniqueId: "5d0464", hostname: "lab-bench" },
  "192.0.2.50": { uniqueId: null, hostname: null },
};
const lookup = async (host: string) => machines[host]!;
const deps = { senderIdentity: lookup, selectedIdentity: lookup };

describe("compareMachineIdentities", () => {
  it("needs both the unique id and the hostname to match, because the unique id is user-editable", () => {
    expect(compareMachineIdentities(machines.c64u!, machines["192.0.2.46"]!)).toBe("same");
    expect(compareMachineIdentities(machines.c64u!, machines["198.51.100.14"]!)).toBe("different");
    expect(compareMachineIdentities(machines.c64u!, machines["198.51.100.13"]!)).toBe("different");
  });

  it("cannot decide when either side is missing its unique id or hostname", () => {
    expect(compareMachineIdentities(machines.c64u!, machines["192.0.2.50"]!)).toBe("unknown");
    expect(compareMachineIdentities(machines.c64u!, { uniqueId: "5d0464", hostname: null })).toBe("unknown");
  });
});

describe("judgeStreamSender", () => {
  beforeEach(() => {
    identify.mockReset();
    isPluginAvailable.mockReturnValue(true);
    constructed.length = 0;
  });

  it("recognizes the selected device streaming from its other network address", async () => {
    expect(await judgeStreamSender("192.0.2.46", "c64u", deps)).toBe("same");
  });

  it("does not take another Ultimate for the selected device, even one given the same unique id", async () => {
    expect(await judgeStreamSender("198.51.100.13", "c64u", deps)).toBe("different");
    expect(await judgeStreamSender("198.51.100.14", "c64u", deps)).toBe("different");
    expect(await judgeStreamSender("192.0.2.50", "c64u", deps)).toBe("unknown");
  });

  it("logs and answers unknown, not different, when the sender cannot be asked", async () => {
    const unreachable = async (): Promise<MachineIdentity> => {
      throw new Error("timeout");
    };
    expect(await judgeStreamSender("192.0.2.46", "c64u", { ...deps, senderIdentity: unreachable })).toBe("unknown");
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Live View: could not tell whether a stream sender is the selected device",
      expect.objectContaining({ source: "192.0.2.46", error: "timeout" }),
    );
  });

  it("asks the sender over ident, so the selected device's password is not sent to it", async () => {
    identify.mockResolvedValue({ uniqueId: "5D0464", hostname: "c64u", replyFrom: "192.0.2.47" });

    expect(await judgeStreamSender("192.0.2.46", "c64u")).toBe("same");

    expect(identify).toHaveBeenCalledWith({ host: "192.0.2.46", timeoutMs: 1500 });
    expect(constructed).toEqual([]);
  });

  it("falls back to a REST lookup that carries no password when ident does not answer", async () => {
    identify.mockResolvedValue({ uniqueId: null, hostname: null, replyFrom: null });

    expect(await judgeStreamSender("192.0.2.46", "c64u")).toBe("same");

    expect(constructed).toEqual([{ baseUrl: "http://192.0.2.46", password: undefined, host: "192.0.2.46" }]);
  });
});
