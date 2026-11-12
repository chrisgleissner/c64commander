/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { isModifiedFromDefault, readConfigItemDefault } from "@/lib/config/configDefault";

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
