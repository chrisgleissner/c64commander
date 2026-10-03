/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  REMOTE_INPUT_AUTH_REQUIRED_HINT,
  REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT,
  remoteInputSupportsJoystick,
  resolveRemoteInputTier,
} from "@/lib/remoteInput/capabilityTier";
import type { MachineInputCapabilityStatus } from "@/lib/deviceCapabilities";

describe("resolveRemoteInputTier", () => {
  it("resolves an available machine:input probe to the full tier", () => {
    expect(resolveRemoteInputTier("available")).toBe("full");
  });

  it("resolves auth-required to its own tier rather than assuming full or fallback", () => {
    expect(resolveRemoteInputTier("auth-required")).toBe("auth-required");
  });

  const fallbackStatuses: MachineInputCapabilityStatus[] = [
    "hardware-unavailable",
    "unsupported-family",
    "missing",
    "error",
  ];

  it.each(fallbackStatuses)("resolves %s to the kernal-fallback tier", (status) => {
    expect(resolveRemoteInputTier(status)).toBe("kernal-fallback");
  });
});

describe("remoteInputSupportsJoystick", () => {
  it("only the full tier supports joystick relay", () => {
    expect(remoteInputSupportsJoystick("full")).toBe(true);
    expect(remoteInputSupportsJoystick("kernal-fallback")).toBe(false);
    expect(remoteInputSupportsJoystick("auth-required")).toBe(false);
  });
});

describe("Remote Input hints", () => {
  // The sheet's two modes are labeled "Joystick" and "Keys"; a hint naming another tab sends the user looking for it.
  it.each([
    ["auth-required", REMOTE_INPUT_AUTH_REQUIRED_HINT],
    ["joystick-unavailable", REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT],
  ])("names only tabs the sheet shows in the %s hint", (_name, hint) => {
    expect(hint).not.toMatch(/\bType\b/);
    expect(hint).toMatch(/\bKeys\b/);
  });
});
