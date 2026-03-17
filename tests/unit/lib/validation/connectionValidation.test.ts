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

  it("returns null for a hostname with a valid port", () => {
    expect(validateDeviceHost("c64u:8064")).toBeNull();
    expect(validateDeviceHost("localhost:8064")).toBeNull();
    expect(validateDeviceHost("my-device.home.lan:9000")).toBeNull();
  });

  it("returns null for an IPv4 address with a valid port", () => {
    expect(validateDeviceHost("127.0.0.1:12345")).toBeNull();
    expect(validateDeviceHost("192.168.1.100:80")).toBeNull();
    expect(validateDeviceHost("127.0.0.1:1")).toBeNull();
  });

  it("returns null for boundary port values", () => {
    expect(validateDeviceHost("c64u:1")).toBeNull();
    expect(validateDeviceHost("c64u:65535")).toBeNull();
  });

  it("returns an error for port 0 (invalid)", () => {
    expect(validateDeviceHost("c64u:0")).not.toBeNull();
  });

  it("returns an error for port out of range", () => {
    expect(validateDeviceHost("c64u:65536")).not.toBeNull();
  });

  it("returns an error for non-numeric port", () => {
    expect(validateDeviceHost("c64u:abc")).not.toBeNull();
  });

  it("returns an error for IPv4 with invalid octet and port", () => {
    expect(validateDeviceHost("300.0.0.1:8064")).not.toBeNull();
  });

  it("returns null for a bare IPv6 address", () => {
    expect(validateDeviceHost("fe80::1")).toBeNull();
    expect(validateDeviceHost("2001:db8::1")).toBeNull();
    expect(validateDeviceHost("::1")).toBeNull();
  });

  it("returns null for a bracketed IPv6 address without port", () => {
    expect(validateDeviceHost("[fe80::1]")).toBeNull();
    expect(validateDeviceHost("[2001:db8::1]")).toBeNull();
  });

  it("returns null for a bracketed IPv6 address with a valid port", () => {
    expect(validateDeviceHost("[fe80::1]:8064")).toBeNull();
    expect(validateDeviceHost("[2001:db8::1]:80")).toBeNull();
  });

  it("returns an error for a bracketed IPv6 address with an invalid port", () => {
    expect(validateDeviceHost("[fe80::1]:0")).not.toBeNull();
    expect(validateDeviceHost("[fe80::1]:65536")).not.toBeNull();
    expect(validateDeviceHost("[fe80::1]:abc")).not.toBeNull();
  });

  it("returns an error for an unclosed IPv6 bracket", () => {
    expect(validateDeviceHost("[fe80::1")).not.toBeNull();
  });
});
