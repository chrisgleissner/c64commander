/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { hasMeaningfulDefault, isModifiedFromDefault, readConfigItemDefault } from "@/lib/config/configDefault";

describe("readConfigItemDefault", () => {
  it("reads the default beside current and values for an enum item", () => {
    expect(readConfigItemDefault({ current: "Manual", values: ["Off", "Manual"], default: "Off" })).toBe("Off");
  });

  it("reads a numeric default and keeps it a number", () => {
    expect(readConfigItemDefault({ current: 9, min: 8, max: 11, format: "%d", default: 8 })).toBe(8);
  });

  it("returns undefined when the payload has no default or is not an object", () => {
    expect(readConfigItemDefault({ current: "On", values: ["On", "Off"] })).toBeUndefined();
    expect(readConfigItemDefault("Off")).toBeUndefined();
    expect(readConfigItemDefault(null)).toBeUndefined();
    expect(readConfigItemDefault([1])).toBeUndefined();
    expect(readConfigItemDefault({ default: { nested: true } })).toBeUndefined();
  });

  it("treats the empty default a ROM file item reports as no default", () => {
    const kernalRom = {
      current: "kernal.901227-03.bin",
      presets: ["basic.901226-01.bin", "kernal.901227-03.bin", "uci_kernal.bin"],
      default: "",
    };
    expect(readConfigItemDefault(kernalRom)).toBeUndefined();
    expect(readConfigItemDefault({ current: "x", default: "  " })).toBeUndefined();
  });
});

describe("isModifiedFromDefault", () => {
  it("is false when no default is known", () => {
    expect(isModifiedFromDefault("Manual", undefined)).toBe(false);
  });

  it("is false for the same text and true for different text", () => {
    expect(isModifiedFromDefault("Off", "Off")).toBe(false);
    expect(isModifiedFromDefault(" Off ", "Off")).toBe(false);
    expect(isModifiedFromDefault("Manual", "Off")).toBe(true);
  });

  it("compares numbers by value, whichever way each side is written", () => {
    expect(isModifiedFromDefault("8", 8)).toBe(false);
    expect(isModifiedFromDefault(8, "8.0")).toBe(false);
    expect(isModifiedFromDefault(9, 8)).toBe(true);
  });

  it("treats a value that carries a unit as text, not as the number inside it", () => {
    expect(isModifiedFromDefault("8 MHz", 8)).toBe(true);
  });
});

describe("hasMeaningfulDefault", () => {
  it.each(["Year", "Month", "Day", "Hours", "Minutes", "Seconds", "Correction"])(
    "has none for the clock item %s",
    (name) => {
      expect(hasMeaningfulDefault("Clock Settings", name)).toBe(false);
    },
  );

  it.each([
    ["Network Settings", "Host Name"],
    ["Network Settings", "Unique ID"],
    ["Network Settings", "Network Password"],
    ["Ethernet Settings", "Static IP"],
    ["WiFi settings", "Static Netmask"],
    ["WiFi settings", "Static Gateway"],
    ["Ethernet Settings", "Static DNS"],
  ])("has none for %s > %s, which identify the device or its network", (category, name) => {
    expect(hasMeaningfulDefault(category, name)).toBe(false);
  });

  it("keeps ordinary settings, including the other network ones", () => {
    expect(hasMeaningfulDefault("U64 Specific Settings", "Turbo Control")).toBe(true);
    expect(hasMeaningfulDefault("Network Settings", "Telnet Remote Menu Service")).toBe(true);
    expect(hasMeaningfulDefault("Ethernet Settings", "Use DHCP")).toBe(true);
  });
});
