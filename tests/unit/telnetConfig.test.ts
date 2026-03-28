/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { clearStoredTelnetPort, getStoredTelnetPort, setStoredTelnetPort } from "@/lib/telnet/telnetConfig";

describe("telnetConfig", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the default Telnet port when missing or invalid", () => {
    expect(getStoredTelnetPort()).toBe(23);
    localStorage.setItem("c64u_telnet_port", "0");
    expect(getStoredTelnetPort()).toBe(23);
    localStorage.setItem("c64u_telnet_port", "abc");
    expect(getStoredTelnetPort()).toBe(23);
  });

  it("stores and clears the Telnet port", () => {
    setStoredTelnetPort(2323);
    expect(getStoredTelnetPort()).toBe(2323);
    clearStoredTelnetPort();
    expect(getStoredTelnetPort()).toBe(23);
  });

  it("ignores invalid values in setStoredTelnetPort", () => {
    setStoredTelnetPort(2323);
    setStoredTelnetPort(0);
    expect(getStoredTelnetPort()).toBe(2323);
  });

  it("rejects non-integer and out-of-range Telnet ports", () => {
    localStorage.setItem("c64u_telnet_port", "70000");
    expect(getStoredTelnetPort()).toBe(23);

    localStorage.setItem("c64u_telnet_port", "12.5");
    expect(getStoredTelnetPort()).toBe(23);

    setStoredTelnetPort(2323);
    setStoredTelnetPort(70000);
    setStoredTelnetPort(12.5);
    expect(getStoredTelnetPort()).toBe(2323);
  });
});
