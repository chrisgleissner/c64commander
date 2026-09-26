// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createDeviceAddressMatcher, createLanHostPolicy } from "../../../web/server/src/hostPolicy";

describe("LAN host policy", () => {
  // HARD27-030: `u64` is the second name the app's own discovery probes for, and
  // the previous fixed allow-list refused it.
  it("accepts a LAN name whose addresses are all private", async () => {
    const resolve = vi.fn(async () => ["192.168.1.64"]);
    const policy = createLanHostPolicy({ resolve });

    await expect(policy.isLanHost("u64")).resolves.toBe(true);
    await expect(policy.isLanHost("c64u.lan:8080")).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith("u64");
  });

  it("refuses a name that resolves outside the private ranges", async () => {
    const policy = createLanHostPolicy({ resolve: async () => ["93.184.216.34"] });
    await expect(policy.isLanHost("example.com")).resolves.toBe(false);
  });

  it("refuses a name whose addresses are only partly private", async () => {
    const policy = createLanHostPolicy({ resolve: async () => ["192.168.1.64", "93.184.216.34"] });
    await expect(policy.isLanHost("rebind.example.com")).resolves.toBe(false);
  });

  it("refuses a name that does not resolve, and one that resolves to nothing", async () => {
    const failing = createLanHostPolicy({
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    await expect(failing.isLanHost("absent")).resolves.toBe(false);

    const empty = createLanHostPolicy({ resolve: async () => [] });
    await expect(empty.isLanHost("empty")).resolves.toBe(false);
  });

  it("answers private literals and the known names without a lookup", async () => {
    const resolve = vi.fn(async () => []);
    const policy = createLanHostPolicy({ resolve });

    await expect(policy.isLanHost("192.168.1.64")).resolves.toBe(true);
    await expect(policy.isLanHost("c64u")).resolves.toBe(true);
    await expect(policy.isLanHost("ultimate.local")).resolves.toBe(true);
    await expect(policy.isLanHost("[fe80::1]:80")).resolves.toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("caches a decision for its TTL and looks the name up again after it", async () => {
    const resolve = vi.fn(async () => ["10.0.0.5"]);
    let clock = 1_000;
    const policy = createLanHostPolicy({ resolve, ttlMs: 60_000, now: () => clock });

    await expect(policy.isLanHost("u64")).resolves.toBe(true);
    await expect(policy.isLanHost("u64")).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1);

    clock += 60_001;
    await expect(policy.isLanHost("u64")).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("keeps the cache bounded", async () => {
    const resolve = vi.fn(async () => ["10.0.0.5"]);
    const policy = createLanHostPolicy({ resolve, maxEntries: 4 });

    for (let index = 0; index < 20; index += 1) {
      await policy.isLanHost(`device-${index}`);
    }
    // The first name was evicted, so asking for it again is a fresh lookup.
    await policy.isLanHost("device-0");
    expect(resolve).toHaveBeenCalledTimes(21);
  });
});

// One Ultimate on Ethernet and Wi-Fi: the router's DNS answers its name with one of its two addresses.
describe("device address matcher", () => {
  const dns: Record<string, string[]> = {
    "ultimate.example": ["192.0.2.10"],
    "alias.example": ["192.0.2.10"],
    "attacker.example": ["192.0.2.10", "203.0.113.66"],
  };
  const resolve = vi.fn(async (hostname: string) => {
    const addresses = dns[hostname];
    if (!addresses) throw new Error(`ENOTFOUND ${hostname}`);
    return addresses;
  });

  it("matches an IP literal that the configured name resolves to", async () => {
    const matcher = createDeviceAddressMatcher({ resolve });

    await expect(matcher.isConfiguredDevice("192.0.2.10", "ultimate.example")).resolves.toBe(true);
    await expect(matcher.isConfiguredDevice("Ultimate.Example", "ultimate.example")).resolves.toBe(true);
  });

  it("never matches another name, even one that also resolves to the device's address", async () => {
    resolve.mockClear();
    const matcher = createDeviceAddressMatcher({ resolve });

    await expect(matcher.isConfiguredDevice("attacker.example", "ultimate.example")).resolves.toBe(false);
    await expect(matcher.isConfiguredDevice("alias.example", "ultimate.example")).resolves.toBe(false);
    await expect(matcher.isConfiguredDevice("ultimate.example", "192.0.2.10")).resolves.toBe(false);
    expect(resolve).not.toHaveBeenCalledWith("attacker.example");
  });

  it("does not match an address the configured name does not resolve to", async () => {
    const matcher = createDeviceAddressMatcher({ resolve });

    await expect(matcher.isConfiguredDevice("198.51.100.20", "ultimate.example")).resolves.toBe(false);
  });

  it("reports a configured name that does not resolve and matches nothing through it", async () => {
    const onResolveError = vi.fn();
    const matcher = createDeviceAddressMatcher({ resolve, onResolveError });

    await expect(matcher.isConfiguredDevice("192.0.2.10", "absent.example")).resolves.toBe(false);
    expect(onResolveError).toHaveBeenCalledWith("absent.example", expect.any(Error));
  });

  it("gives up on a lookup that does not answer in time and matches nothing", async () => {
    vi.useFakeTimers();
    try {
      const onResolveError = vi.fn();
      const matcher = createDeviceAddressMatcher({
        resolve: () => new Promise<string[]>(() => {}),
        resolveTimeoutMs: 2000,
        onResolveError,
      });

      const answer = matcher.isConfiguredDevice("192.0.2.10", "ultimate.example");
      await vi.advanceTimersByTimeAsync(2000);

      await expect(answer).resolves.toBe(false);
      expect(onResolveError).toHaveBeenCalledWith("ultimate.example", expect.any(Error));
    } finally {
      vi.useRealTimers();
    }
  });

  it("caches the configured name's addresses for their TTL", async () => {
    const counted = vi.fn(async (hostname: string) => dns[hostname] ?? []);
    let clock = 1_000;
    const matcher = createDeviceAddressMatcher({ resolve: counted, ttlMs: 60_000, now: () => clock });

    await matcher.isConfiguredDevice("192.0.2.10", "ultimate.example");
    await matcher.isConfiguredDevice("192.0.2.10", "ultimate.example");
    expect(counted).toHaveBeenCalledTimes(1);

    clock += 60_001;
    await matcher.isConfiguredDevice("192.0.2.10", "ultimate.example");
    expect(counted).toHaveBeenCalledTimes(2);
  });
});
