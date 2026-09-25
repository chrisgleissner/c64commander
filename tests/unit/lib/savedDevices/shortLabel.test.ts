/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { buildDeviceShortLabel } from "@/lib/savedDevices/shortLabel";

describe("the device's short label for a phone's header", () => {
  it("uses the user's own name for the device", () => {
    expect(buildDeviceShortLabel("Living rm", "C64U")).toBe("Living rm");
  });

  it("uses a short host name, without its domain or port", () => {
    expect(buildDeviceShortLabel("c64u", "C64U")).toBe("c64u");
    expect(buildDeviceShortLabel("c64u.local:8080", "C64U")).toBe("c64u");
  });

  it("names the product instead of an IP address, which truncated names nothing", () => {
    expect(buildDeviceShortLabel("192.168.1.13", "U64E")).toBe("U64E");
    expect(buildDeviceShortLabel("192.168.1.74:80", "U2")).toBe("U2");
  });

  it("names the product instead of a host name too long for the header", () => {
    expect(buildDeviceShortLabel("Ultimate-64-Elite-F83C87", "U64E")).toBe("U64E");
  });

  it("has nothing to show for an IP address of a device not yet identified", () => {
    expect(buildDeviceShortLabel("192.168.1.13", null)).toBeNull();
  });
});
