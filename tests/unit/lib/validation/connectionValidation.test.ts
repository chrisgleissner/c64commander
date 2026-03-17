/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { validateDeviceHost } from "@/lib/validation/connectionValidation";

describe("validateDeviceHost", () => {
  it("returns null for empty string (uses application default)", () => {
    expect(validateDeviceHost("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(validateDeviceHost("   ")).toBeNull();
  });

  it("returns null for a simple hostname", () => {
    expect(validateDeviceHost("c64u")).toBeNull();
  });

  it("returns null for a dotted hostname", () => {
    expect(validateDeviceHost("c64u.local")).toBeNull();
  });

  it("returns null for a multi-label hostname", () => {
    expect(validateDeviceHost("my-device.home.lan")).toBeNull();
  });

  it("returns null for a valid IPv4 address", () => {
    expect(validateDeviceHost("192.168.1.100")).toBeNull();
  });

  it("returns null for boundary IPv4 addresses", () => {
    expect(validateDeviceHost("0.0.0.0")).toBeNull();
    expect(validateDeviceHost("255.255.255.255")).toBeNull();
  });

  it("returns an error for an IPv4 address with out-of-range octet", () => {
    expect(validateDeviceHost("192.168.1.256")).not.toBeNull();
  });

  it("returns an error for an IPv4 address with a negative-looking octet pattern", () => {
    expect(validateDeviceHost("300.0.0.1")).not.toBeNull();
  });

  it("returns an error for a hostname with consecutive dots", () => {
    expect(validateDeviceHost("c64u..local")).not.toBeNull();
  });

  it("returns an error for a hostname starting with a hyphen", () => {
    expect(validateDeviceHost("-c64u")).not.toBeNull();
  });

  it("returns an error for a hostname ending with a hyphen", () => {
    expect(validateDeviceHost("c64u-")).not.toBeNull();
  });

  it("returns an error for a string with spaces", () => {
    expect(validateDeviceHost("c64 u")).not.toBeNull();
  });

  it("returns an error for an empty label (leading dot)", () => {
    expect(validateDeviceHost(".c64u")).not.toBeNull();
  });
});
