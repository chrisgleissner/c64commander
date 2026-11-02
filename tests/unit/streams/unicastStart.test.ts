/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));
const streamUdp = vi.hoisted(() => ({ prepareUnicast: vi.fn() }));
vi.mock("@/lib/native/streamUdp", () => ({ StreamUdp: streamUdp }));

import { addLog } from "@/lib/logging";
import {
  UNICAST_RETRY_DELAY_MS,
  UNICAST_START_ATTEMPTS,
  isHostResolveError,
  isMulticastDestination,
  makeUnicastPathReady,
  startStreamResolvingHost,
} from "@/lib/streams/unicastStart";

const resolveError = () => new Error("Firmware rejected stream audio start: Network Host Resolve Error");
const noWait = () => Promise.resolve();

describe("asking the Ultimate for a unicast stream", () => {
  beforeEach(() => {
    vi.mocked(addLog).mockClear();
    streamUdp.prepareUnicast.mockReset().mockResolvedValue({ address: "192.168.1.247", reachable: true });
  });

  it("recognizes the firmware's host resolve error, and no other error", () => {
    expect(isHostResolveError(resolveError())).toBe(true);
    expect(isHostResolveError("network host resolve error")).toBe(true);
    expect(isHostResolveError(new Error("Wired Ethernet link is down"))).toBe(false);
  });

  it("recognizes multicast groups from 224 to 239 and no unicast address", () => {
    expect(isMulticastDestination("239.0.1.65:11001")).toBe(true);
    expect(isMulticastDestination("224.0.0.1")).toBe(true);
    expect(isMulticastDestination("192.168.1.247:11001")).toBe(false);
    expect(isMulticastDestination("240.0.0.1:1")).toBe(false);
    expect(isMulticastDestination("c64u:11001")).toBe(false);
  });

  it("sends a multicast request once and does not touch the phone's network path", async () => {
    const start = vi.fn().mockRejectedValue(resolveError());
    const makeReady = vi.fn();

    await expect(startStreamResolvingHost(start, "239.0.1.65:11001", makeReady, noWait)).rejects.toThrow(/Resolve/);

    expect(start).toHaveBeenCalledTimes(1);
    expect(makeReady).not.toHaveBeenCalled();
  });

  it("asks again after making this phone findable when the Ultimate could not find it", async () => {
    const start = vi.fn().mockRejectedValueOnce(resolveError()).mockResolvedValueOnce({ errors: [] });
    const makeReady = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await startStreamResolvingHost(start, "192.168.1.247:11001", makeReady, sleep);

    expect(result).toEqual({ errors: [] });
    expect(start).toHaveBeenCalledTimes(2);
    expect(makeReady).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(UNICAST_RETRY_DELAY_MS);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "The Ultimate could not find this phone yet; trying again",
      expect.objectContaining({ attempt: 1 }),
    );
  });

  it("gives up with the firmware's own error after the last attempt", async () => {
    const start = vi.fn().mockRejectedValue(resolveError());

    await expect(startStreamResolvingHost(start, "192.168.1.247:11001", vi.fn(), noWait)).rejects.toThrow(
      /Network Host Resolve Error/,
    );

    expect(start).toHaveBeenCalledTimes(UNICAST_START_ATTEMPTS);
  });

  it("does not retry an error that is not about finding the phone", async () => {
    const start = vi.fn().mockRejectedValue(new Error("Wired Ethernet link is down or has no IP address"));
    const makeReady = vi.fn();

    await expect(startStreamResolvingHost(start, "192.168.1.247:11001", makeReady, noWait)).rejects.toThrow(/Wired/);

    expect(start).toHaveBeenCalledTimes(1);
    expect(makeReady).not.toHaveBeenCalled();
  });

  it("waits on the real clock by default", async () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn().mockRejectedValueOnce(resolveError()).mockResolvedValueOnce("ok");
      const pending = startStreamResolvingHost(start, "192.168.1.247:11001", vi.fn().mockResolvedValue(undefined));
      await vi.advanceTimersByTimeAsync(UNICAST_RETRY_DELAY_MS);

      await expect(pending).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("prepares the phone's path through the plugin, and logs instead of failing when the plugin cannot", async () => {
    await makeUnicastPathReady("192.168.1.146");
    expect(streamUdp.prepareUnicast).toHaveBeenCalledWith({ host: "192.168.1.146" });

    streamUdp.prepareUnicast.mockRejectedValueOnce(new Error("not implemented on web"));
    await expect(makeUnicastPathReady("192.168.1.146")).resolves.toBeUndefined();
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Could not make this phone findable by the Ultimate",
      expect.objectContaining({ host: "192.168.1.146", error: "not implemented on web" }),
    );
  });

  it("logs a failure that is not an Error with its text", async () => {
    streamUdp.prepareUnicast.mockRejectedValueOnce("radio off");

    await makeUnicastPathReady("192.168.1.146");

    expect(addLog).toHaveBeenCalledWith("warn", "Could not make this phone findable by the Ultimate", {
      host: "192.168.1.146",
      error: "radio off",
    });
  });
});
