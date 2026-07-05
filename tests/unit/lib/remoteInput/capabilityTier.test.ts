/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { remoteInputSupportsJoystick, resolveRemoteInputTier } from "@/lib/remoteInput/capabilityTier";
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
