/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import {
  CARTRIDGE_CATEGORY,
  CARTRIDGE_ITEM,
  detectSnapshotCapability,
  getCartridgeConfig,
  isMeaningfulCartridge,
  type CapabilityApi,
} from "@/lib/snapshot/cpu/capability";
import type { ConfigResponse, DeviceInfo, VersionInfo } from "@/lib/c64api";

const INFO: DeviceInfo = {
  product: "Ultimate 64 Elite",
  firmware_version: "3.14e",
  fpga_version: "122",
  core_version: "1.4B",
  hostname: "u64",
  unique_id: "38C1BA",
  errors: [],
};

const VERSION: VersionInfo = { version: "0.1", errors: [] };

const makeApi = (overrides: Partial<CapabilityApi> = {}): CapabilityApi => ({
  getInfo: vi.fn(async () => INFO),
  getVersion: vi.fn(async () => VERSION),
  getConfigItem: vi.fn(async () => ({ errors: [] }) as ConfigResponse),
  ...overrides,
});

describe("detectSnapshotCapability", () => {
  it("reports supported with a firmware fingerprint when /v1/info is healthy", async () => {
    const cap = await detectSnapshotCapability(makeApi());
    expect(cap.cpuSnapshotSupported).toBe(true);
    expect(cap.firmware).toEqual({
      product: "Ultimate 64 Elite",
      firmware_version: "3.14e",
      fpga_version: "122",
      core_version: "1.4B",
      api_version: "0.1",
    });
    expect(cap.reason).toBeUndefined();
  });

  it("is unsupported (with a reason) when /v1/info 404s on old firmware", async () => {
    const cap = await detectSnapshotCapability(
      makeApi({
        getInfo: vi.fn(async () => {
          throw new Error("HTTP 404 Not Found");
        }),
      }),
    );
    expect(cap.cpuSnapshotSupported).toBe(false);
    expect(cap.reason).toMatch(/404/);
    // Still records whatever metadata it could (api_version from /v1/version).
    expect(cap.firmware.api_version).toBe("0.1");
  });

  it("is unsupported when /v1/info returns errors", async () => {
    const cap = await detectSnapshotCapability(
      makeApi({ getInfo: vi.fn(async () => ({ errors: ["Forbidden."] }) as DeviceInfo) }),
    );
    expect(cap.cpuSnapshotSupported).toBe(false);
    expect(cap.reason).toMatch(/Forbidden/);
  });

  it("still succeeds when /v1/version is unavailable (api_version omitted)", async () => {
    const cap = await detectSnapshotCapability(
      makeApi({
        getVersion: vi.fn(async () => {
          throw new Error("boom");
        }),
      }),
    );
    expect(cap.cpuSnapshotSupported).toBe(true);
    expect(cap.firmware.api_version).toBeUndefined();
  });
});

describe("isMeaningfulCartridge", () => {
  it("treats real cartridge files as meaningful", () => {
    expect(isMeaningfulCartridge("Final_Cartridge_3_1988-13.crt")).toBe(true);
  });

  it.each(["", "  ", "None", "none", "Empty", "-", "Disabled", "No Cartridge"])(
    "treats %p as no cartridge",
    (value) => {
      expect(isMeaningfulCartridge(value)).toBe(false);
    },
  );

  it("treats null/undefined as no cartridge", () => {
    expect(isMeaningfulCartridge(undefined)).toBe(false);
    expect(isMeaningfulCartridge(null)).toBe(false);
  });
});

describe("getCartridgeConfig", () => {
  it("extracts the selected cartridge from an object-shaped config item", async () => {
    const response: ConfigResponse = {
      [CARTRIDGE_CATEGORY]: {
        [CARTRIDGE_ITEM]: {
          selected: "Final_Cartridge_3_1988-13.crt",
          options: ["None", "Final_Cartridge_3_1988-13.crt"],
        },
      },
      errors: [],
    } as unknown as ConfigResponse;
    const api = makeApi({ getConfigItem: vi.fn(async () => response) });

    const meta = await getCartridgeConfig(api);
    expect(meta).toEqual({
      configured_name: "Final_Cartridge_3_1988-13.crt",
      was_active: true,
      ram_resident_assumed: true,
    });
    expect(api.getConfigItem).toHaveBeenCalledWith(CARTRIDGE_CATEGORY, CARTRIDGE_ITEM);
  });

  it("extracts a string-shaped config item", async () => {
    const response: ConfigResponse = {
      [CARTRIDGE_CATEGORY]: { [CARTRIDGE_ITEM]: "Action_Replay.crt" },
      errors: [],
    } as unknown as ConfigResponse;
    const meta = await getCartridgeConfig(makeApi({ getConfigItem: vi.fn(async () => response) }));
    expect(meta.configured_name).toBe("Action_Replay.crt");
    expect(meta.was_active).toBe(true);
  });

  it("reports no cartridge when the selection is a sentinel", async () => {
    const response: ConfigResponse = {
      [CARTRIDGE_CATEGORY]: { [CARTRIDGE_ITEM]: { selected: "None" } },
      errors: [],
    } as unknown as ConfigResponse;
    const meta = await getCartridgeConfig(makeApi({ getConfigItem: vi.fn(async () => response) }));
    expect(meta.configured_name).toBeUndefined();
    expect(meta.was_active).toBe(false);
    expect(meta.ram_resident_assumed).toBe(true);
  });

  it("degrades to unknown when the config read throws", async () => {
    const meta = await getCartridgeConfig(
      makeApi({
        getConfigItem: vi.fn(async () => {
          throw new Error("network");
        }),
      }),
    );
    expect(meta).toEqual({ configured_name: undefined, was_active: false, ram_resident_assumed: true });
  });
});
