/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const addLog = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logging", () => ({ addLog }));

import { createSeekRequestChannel } from "@/lib/input/lockScreenSeekChannel";

describe("lock-screen seek channel (QW-LS-03)", () => {
  beforeEach(() => {
    addLog.mockReset();
  });

  it("delivers a seek request to every subscriber", () => {
    const channel = createSeekRequestChannel();
    const first = vi.fn();
    const second = vi.fn();
    channel.subscribe(first);
    channel.subscribe(second);

    channel.publish(42_000);

    expect(first).toHaveBeenCalledWith(42_000);
    expect(second).toHaveBeenCalledWith(42_000);
    expect(addLog).not.toHaveBeenCalled();
  });

  it("drops a request that has no subscriber and logs it at warn level", () => {
    const channel = createSeekRequestChannel();

    channel.publish(42_000);

    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Dropped a lock-screen seek request: the Play page is not mounted",
      expect.objectContaining({ positionMs: 42_000 }),
    );
  });

  it("does not replay a dropped request to a subscriber that arrives later", () => {
    const channel = createSeekRequestChannel();
    channel.publish(42_000);

    const late = vi.fn();
    channel.subscribe(late);

    expect(late).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe, and drops and logs the next request", () => {
    const channel = createSeekRequestChannel();
    const handler = vi.fn();
    const unsubscribe = channel.subscribe(handler);
    unsubscribe();
    unsubscribe();

    channel.publish(1_000);

    expect(handler).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("Dropped"), expect.anything());
  });

  it("logs a throwing subscriber at error level and still serves the others", () => {
    const channel = createSeekRequestChannel();
    const healthy = vi.fn();
    channel.subscribe(() => {
      throw new Error("seek exploded");
    });
    channel.subscribe(healthy);

    channel.publish(5_000);

    expect(healthy).toHaveBeenCalledWith(5_000);
    expect(addLog).toHaveBeenCalledWith(
      "error",
      "A lock-screen seek subscriber failed",
      expect.objectContaining({ positionMs: 5_000, error: "seek exploded" }),
    );
  });
});
