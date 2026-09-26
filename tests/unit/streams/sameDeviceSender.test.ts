/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import { isSelectedDeviceSender } from "@/lib/streams/sameDeviceSender";

const ids: Record<string, string | null> = {
  c64u: "5D0464",
  "192.168.1.146": "5D0464",
  "192.168.1.13": "8A7F21",
  "192.168.1.50": null,
};
const fetchUniqueId = async (host: string) => ids[host] ?? null;

describe("isSelectedDeviceSender", () => {
  it("recognizes the selected device streaming from its other network address", async () => {
    expect(await isSelectedDeviceSender("192.168.1.146", "c64u", fetchUniqueId)).toBe(true);
  });

  it("does not take another Ultimate, or one that reports no id, for the selected device", async () => {
    expect(await isSelectedDeviceSender("192.168.1.13", "c64u", fetchUniqueId)).toBe(false);
    expect(await isSelectedDeviceSender("192.168.1.50", "c64u", fetchUniqueId)).toBe(false);
  });

  it("logs and answers no when the sender cannot be asked", async () => {
    const unreachable = async () => {
      throw new Error("timeout");
    };
    expect(await isSelectedDeviceSender("192.168.1.146", "c64u", unreachable)).toBe(false);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Live View: could not tell whether a refused stream sender is the selected device",
      expect.objectContaining({ source: "192.168.1.146", error: "timeout" }),
    );
  });
});
