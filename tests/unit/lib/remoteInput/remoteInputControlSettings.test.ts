/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REMOTE_INPUT_CONTROL_SIZE,
  loadRemoteInputControlSize,
  remoteInputControlScale,
  saveRemoteInputControlSize,
  stepRemoteInputControlSize,
} from "@/lib/remoteInput/remoteInputControlSettings";

const KEY = "c64u_remote_input_control_size";

describe("remoteInputControlSettings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to L (one step above the cramped original M size)", () => {
    expect(DEFAULT_REMOTE_INPUT_CONTROL_SIZE).toBe("L");
    expect(loadRemoteInputControlSize()).toBe("L");
  });

  it("round-trips a saved size through localStorage", () => {
    saveRemoteInputControlSize("XL");
    expect(localStorage.getItem(KEY)).toBe("XL");
    expect(loadRemoteInputControlSize()).toBe("XL");
  });

  it("falls back to the default for a corrupt/unknown persisted value", () => {
    localStorage.setItem(KEY, "GIGANTIC");
    expect(loadRemoteInputControlSize()).toBe("L");
  });

  it("scales up monotonically with size", () => {
    expect(remoteInputControlScale("M")).toBe(1);
    expect(remoteInputControlScale("L")).toBeGreaterThan(remoteInputControlScale("M"));
    expect(remoteInputControlScale("XL")).toBeGreaterThan(remoteInputControlScale("L"));
    expect(remoteInputControlScale("XXL")).toBeGreaterThan(remoteInputControlScale("XL"));
  });

  it("steps within range and clamps at the ends", () => {
    expect(stepRemoteInputControlSize("M", -1)).toBe("M"); // clamped low
    expect(stepRemoteInputControlSize("M", 1)).toBe("L");
    expect(stepRemoteInputControlSize("XL", 1)).toBe("XXL");
    expect(stepRemoteInputControlSize("XXL", 1)).toBe("XXL"); // clamped high
    expect(stepRemoteInputControlSize("XXL", -1)).toBe("XL");
  });

  it("ignores an invalid size on save", () => {
    saveRemoteInputControlSize("bogus" as never);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
