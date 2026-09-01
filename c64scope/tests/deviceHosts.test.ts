import { describe, expect, it } from "vitest";
import { DEFAULT_C64U_HOST, DEVICE_HOSTS, resolveDeviceHost } from "../src/deviceHosts.js";

/**
 * The bench addressed the Ultimate at a fixed 192.168.1.13. DHCP moved it, so the
 * default pointed at neither machine while still looking deliberate.
 */

describe("bench device hosts", () => {
  it("names each machine rather than addressing it", () => {
    for (const host of Object.values(DEVICE_HOSTS)) {
      expect(host, `${host} is an address, not a name`).not.toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
    }
    expect(Object.keys(DEVICE_HOSTS).sort()).toEqual(["c64u", "u2", "u64"]);
  });

  it("defaults to the Ultimate by name", () => {
    expect(DEFAULT_C64U_HOST).toBe("c64u");
    expect(resolveDeviceHost({})).toBe("c64u");
  });

  it("lets C64U_HOST name any machine, by name or address", () => {
    expect(resolveDeviceHost({ C64U_HOST: "u64" })).toBe("u64");
    expect(resolveDeviceHost({ C64U_HOST: "10.0.0.5" })).toBe("10.0.0.5");
  });

  it("ignores an empty override rather than resolving an empty host", () => {
    expect(resolveDeviceHost({ C64U_HOST: "   " })).toBe("c64u");
  });
});
