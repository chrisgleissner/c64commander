/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LATCHED_COMMAND_TTL_MS,
  createLatchedCommandBus,
  transportCommandBus,
  type TransportCommand,
} from "@/lib/input/latchedCommandBus";

describe("latched command bus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    transportCommandBus.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    transportCommandBus.reset();
  });

  it("expires an unclaimed command after five seconds", () => {
    expect(LATCHED_COMMAND_TTL_MS).toBe(5_000);
  });

  /*
   * The defect this exists for: F1 is pressed on Home, the transport lives on Play, and the app
   * navigates. keypadCommands' plain window.dispatchEvent would be gone before Play subscribed.
   */
  it("delivers a command published with no consumer mounted, when one mounts later", () => {
    const bus = createLatchedCommandBus<TransportCommand>("test-transport", LATCHED_COMMAND_TTL_MS);
    bus.publish("playPause");
    expect(bus.takePending()).toBe("playPause");
  });

  it("delivers a latched command exactly once", () => {
    const bus = createLatchedCommandBus<TransportCommand>("test-transport", LATCHED_COMMAND_TTL_MS);
    bus.publish("next");
    expect(bus.takePending()).toBe("next");
    expect(bus.takePending()).toBeNull();
  });

  it("discards a command older than five seconds, so it cannot fire on an unrelated navigation", () => {
    const bus = createLatchedCommandBus<TransportCommand>("test-transport", LATCHED_COMMAND_TTL_MS);
    bus.publish("playPause");
    vi.advanceTimersByTime(LATCHED_COMMAND_TTL_MS + 1);
    expect(bus.takePending()).toBeNull();
  });

  it("keeps a command that is exactly at the expiry boundary", () => {
    const bus = createLatchedCommandBus<TransportCommand>("test-transport", LATCHED_COMMAND_TTL_MS);
    bus.publish("playPause");
    vi.advanceTimersByTime(LATCHED_COMMAND_TTL_MS);
    expect(bus.takePending()).toBe("playPause");
  });

  it("also dispatches, so a consumer already mounted acts in place", () => {
    const bus = createLatchedCommandBus<TransportCommand>("test-transport-live", LATCHED_COMMAND_TTL_MS);
    const seen: TransportCommand[] = [];
    const release = bus.subscribe((command) => seen.push(command));
    bus.publish("next");
    release();
    expect(seen).toEqual(["next"]);
  });

  it("stops delivering to a consumer that has unsubscribed", () => {
    const bus = createLatchedCommandBus<TransportCommand>("test-transport-live", LATCHED_COMMAND_TTL_MS);
    const seen: TransportCommand[] = [];
    bus.subscribe((command) => seen.push(command))();
    bus.publish("next");
    expect(seen).toEqual([]);
  });

  it("keeps only the newest command when two are published before either is claimed", () => {
    const bus = createLatchedCommandBus<TransportCommand>("test-transport", LATCHED_COMMAND_TTL_MS);
    bus.publish("playPause");
    bus.publish("next");
    expect(bus.takePending()).toBe("next");
    expect(bus.takePending()).toBeNull();
  });
});
