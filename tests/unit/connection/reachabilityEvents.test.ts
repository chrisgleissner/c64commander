/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("reachabilityEvents", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("delivers queued reachability events when the connection manager registers", async () => {
    const { notifyReachable, registerReachabilityListener } =
      await import("../../../src/lib/connection/reachabilityEvents");
    const listener = vi.fn();
    const deviceInfo = {
      product: "Ultimate 64 Elite",
      firmware_version: "3.14e",
      hostname: "u64",
      errors: [],
    };

    notifyReachable("u64", "rest", deviceInfo);
    expect(listener).not.toHaveBeenCalled();

    registerReachabilityListener(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("u64", "rest", deviceInfo);
  });

  it("stops delivering reachability events after unregistering the active listener", async () => {
    const { notifyReachable, registerReachabilityListener } =
      await import("../../../src/lib/connection/reachabilityEvents");
    const listener = vi.fn();

    const unregister = registerReachabilityListener(listener);
    unregister();
    notifyReachable("u64", "rest");

    expect(listener).not.toHaveBeenCalled();
  });
});
