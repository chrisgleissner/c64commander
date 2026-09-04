// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLanHostPolicy } from "../../../web/server/src/hostPolicy";

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
