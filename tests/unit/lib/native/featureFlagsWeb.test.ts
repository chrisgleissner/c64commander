/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildLocalStorageKey } from "@/generated/variant";
import { FeatureFlagsWeb } from "@/lib/native/featureFlags.web";

const buildFlagKey = (key: string) => `${buildLocalStorageKey("feature_flag")}:${key}`;

describe("FeatureFlagsWeb", () => {
  let plugin: FeatureFlagsWeb;

  beforeEach(() => {
    plugin = new FeatureFlagsWeb();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("returns empty when flag not set", async () => {
    const result = await plugin.getFlag({ key: "test_flag" });
    expect(result).toEqual({});
  });

  it('setFlag(true) stores "1" and getFlag returns true', async () => {
    await plugin.setFlag({ key: "test_flag", value: true });
    const result = await plugin.getFlag({ key: "test_flag" });
    expect(result).toEqual({ value: true });
  });

  it('setFlag(false) stores "0" and getFlag returns false (line 25 FALSE branch)', async () => {
    // This covers the ternary FALSE branch: options.value = false → '0'
    await plugin.setFlag({ key: "test_flag", value: false });
    expect(localStorage.getItem(buildFlagKey("test_flag"))).toBe("0");
    const result = await plugin.getFlag({ key: "test_flag" });
    expect(result).toEqual({ value: false });
  });

  it("getAllFlags returns stored flag values", async () => {
    await plugin.setFlag({ key: "flag_a", value: true });
    await plugin.setFlag({ key: "flag_b", value: false });
    const result = await plugin.getAllFlags({
      keys: ["flag_a", "flag_b", "missing"],
    });
    expect(result.flags).toEqual({ flag_a: true, flag_b: false });
  });

  it("clearFlag removes the stored override from localStorage and sessionStorage", async () => {
    await plugin.setFlag({ key: "clearable", value: true });
    expect(localStorage.getItem(buildFlagKey("clearable"))).toBe("1");
    expect(sessionStorage.getItem(buildFlagKey("clearable"))).toBe("1");

    await plugin.clearFlag({ key: "clearable" });

    expect(localStorage.getItem(buildFlagKey("clearable"))).toBeNull();
    expect(sessionStorage.getItem(buildFlagKey("clearable"))).toBeNull();
    const result = await plugin.getFlag({ key: "clearable" });
    expect(result).toEqual({});
  });

  it("clearFlag is idempotent when no override exists", async () => {
    await expect(plugin.clearFlag({ key: "never_set" })).resolves.toBeUndefined();
    const result = await plugin.getFlag({ key: "never_set" });
    expect(result).toEqual({});
  });
});
