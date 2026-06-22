/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { isTelnetCapableProduct, resolveTelnetMenuKey } from "@/lib/telnet/telnetTypes";

describe("resolveTelnetMenuKey", () => {
  it("maps C64U to the F1 menu", () => {
    expect(resolveTelnetMenuKey("C64 Ultimate")).toBe("F1");
  });

  it("maps the U64 family to the F5 menu", () => {
    expect(resolveTelnetMenuKey("Ultimate 64")).toBe("F5");
    expect(resolveTelnetMenuKey("Ultimate 64 Elite")).toBe("F5");
    expect(resolveTelnetMenuKey("Ultimate 64-II")).toBe("F5");
  });

  it("maps the Ultimate II (U2) family to the F1 menu (firmware runs the telnet service on U2)", () => {
    expect(resolveTelnetMenuKey("Ultimate II")).toBe("F1");
    expect(resolveTelnetMenuKey("Ultimate II+")).toBe("F1");
    expect(resolveTelnetMenuKey("Ultimate II+L")).toBe("F1");
  });

  it("returns null for unknown or missing products", () => {
    expect(resolveTelnetMenuKey("Some Printer")).toBeNull();
    expect(resolveTelnetMenuKey(null)).toBeNull();
    expect(resolveTelnetMenuKey(undefined)).toBeNull();
  });
});

describe("isTelnetCapableProduct", () => {
  it("treats every recognised Ultimate family (incl. U2) as telnet-capable", () => {
    expect(isTelnetCapableProduct("C64 Ultimate")).toBe(true);
    expect(isTelnetCapableProduct("Ultimate 64")).toBe(true);
    expect(isTelnetCapableProduct("Ultimate II+")).toBe(true);
  });

  it("treats unknown products as not telnet-capable", () => {
    expect(isTelnetCapableProduct("Some Printer")).toBe(false);
  });
});
