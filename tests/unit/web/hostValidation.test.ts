// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isConfiguredDeviceHost,
  isTrustedInsecureHost,
  normalizePassword,
  sanitizeHost,
  safeCompare,
} from "../../../web/server/src/hostValidation";

describe("hostValidation", () => {
  it("accepts trusted local and private hosts", () => {
    expect(isTrustedInsecureHost("c64u")).toBe(true);
    expect(isTrustedInsecureHost("localhost")).toBe(true);
    expect(isTrustedInsecureHost("127.0.0.1")).toBe(true);
    expect(isTrustedInsecureHost("device.local")).toBe(true);
    expect(isTrustedInsecureHost("10.0.0.5")).toBe(true);
    expect(isTrustedInsecureHost("172.16.0.1")).toBe(true);
    expect(isTrustedInsecureHost("172.31.255.255")).toBe(true);
    expect(isTrustedInsecureHost("192.168.1.25:8080")).toBe(true);
    expect(isTrustedInsecureHost("169.254.1.20")).toBe(true);
    expect(isTrustedInsecureHost("[::1]")).toBe(true);
    expect(isTrustedInsecureHost("[fe80::1]:8080")).toBe(true);
    expect(isTrustedInsecureHost("fc00::1")).toBe(true);
  });

  it("rejects empty, public, and malformed trusted-host candidates", () => {
    expect(isTrustedInsecureHost("")).toBe(false);
    expect(isTrustedInsecureHost("8.8.8.8")).toBe(false);
    expect(isTrustedInsecureHost("172.15.0.1")).toBe(false);
    expect(isTrustedInsecureHost("172.32.0.1")).toBe(false);
    expect(isTrustedInsecureHost("example.com")).toBe(false);
    expect(isTrustedInsecureHost("[2001:db8::1]")).toBe(false);
  });

  it("normalizes passwords and sanitizes supported hosts", () => {
    expect(normalizePassword(undefined)).toBeNull();
    expect(normalizePassword("   ")).toBeNull();
    expect(normalizePassword("  secret  ")).toBe("secret");

    expect(sanitizeHost(undefined)).toBeNull();
    expect(sanitizeHost(" https://c64u ")).toBeNull();
    expect(sanitizeHost("bad host")).toBeNull();
    expect(sanitizeHost("bad/path")).toBeNull();
    expect(sanitizeHost("c64u")).toBe("c64u");
    expect(sanitizeHost("device.local:8080")).toBe("device.local:8080");
    expect(sanitizeHost("127.0.0.1")).toBe("127.0.0.1");
    expect(sanitizeHost("[fe80::1]:65000")).toBe("[fe80::1]:65000");
  });

  it("rejects malformed ports, bracketed IPv6 forms, and invalid hostnames", () => {
    expect(sanitizeHost("device.local:0")).toBeNull();
    expect(sanitizeHost("device.local:70000")).toBeNull();
    expect(sanitizeHost("device.local:abc")).toBeNull();
    expect(sanitizeHost("[fe80::1")).toBeNull();
    expect(sanitizeHost("[not-ipv6]:8080")).toBeNull();
    expect(sanitizeHost("two:ports:8080")).toBeNull();
    expect(sanitizeHost("-bad-host")).toBeNull();
    expect(sanitizeHost(`${"a".repeat(254)}.local`)).toBeNull();
  });

  // HARD27-016: the proxy decides whether to attach the configured device
  // password by comparing the target with the configured host, so the two
  // spellings of the same device have to compare equal.
  it("treats a missing port as the HTTP default when matching the configured device", () => {
    expect(isConfiguredDeviceHost("c64u", "c64u:80")).toBe(true);
    expect(isConfiguredDeviceHost("C64U:80", "c64u")).toBe(true);
    expect(isConfiguredDeviceHost("[fe80::1]", "[FE80::1]:80")).toBe(true);
    expect(isConfiguredDeviceHost("192.168.1.64:8080", "192.168.1.64:8080")).toBe(true);
  });

  it("does not treat another host, port or empty value as the configured device", () => {
    expect(isConfiguredDeviceHost("10.0.0.9", "192.168.1.64")).toBe(false);
    expect(isConfiguredDeviceHost("192.168.1.64:8080", "192.168.1.64")).toBe(false);
    expect(isConfiguredDeviceHost("localhost", "c64u")).toBe(false);
    expect(isConfiguredDeviceHost("", "c64u")).toBe(false);
    expect(isConfiguredDeviceHost("c64u", "")).toBe(false);
  });

  it("compares secrets safely only when lengths match", () => {
    expect(safeCompare("secret", "secret")).toBe(true);
    expect(safeCompare("secret", "SECRET")).toBe(false);
    expect(safeCompare("short", "longer")).toBe(false);
  });
});
