/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import type { ConfigResponse, DeviceInfo, VersionInfo } from "@/lib/c64api";
import type { CartridgeMeta, FirmwareCapability } from "../snapshotTypes";

/**
 * The cartridge config lives under this category/item on Ultimate firmware
 * (`GET /v1/configs/C64 and Cartridge Settings/Cartridge`).
 */
export const CARTRIDGE_CATEGORY = "C64 and Cartridge Settings";
export const CARTRIDGE_ITEM = "Cartridge";

/**
 * Sentinel values the firmware uses for "no cartridge". A configured name equal
 * to one of these (case-insensitively) is treated as "no cartridge present".
 */
const NO_CARTRIDGE_SENTINELS = new Set(["", "none", "empty", "-", "disabled", "no cartridge"]);

/** The minimal slice of the REST client this module needs (kept structural for testability). */
export type CapabilityApi = {
  getInfo: (options?: Record<string, unknown>) => Promise<DeviceInfo>;
  getVersion: () => Promise<VersionInfo>;
  getConfigItem: (category: string, item: string, options?: Record<string, unknown>) => Promise<ConfigResponse>;
};

export type SnapshotCapability = {
  /** Firmware/capability fingerprint recorded with the snapshot. */
  firmware: FirmwareCapability;
  /** Whether CPU+RAM capture/restore may be offered for this device. */
  cpuSnapshotSupported: boolean;
  /** Human-readable reason when unsupported (for UI/diagnostics). */
  reason?: string;
};

const hasErrors = (errors: unknown): boolean => Array.isArray(errors) && errors.length > 0;

/** True when `name` denotes a real cartridge file rather than a "no cartridge" sentinel. */
export const isMeaningfulCartridge = (name: string | undefined | null): boolean => {
  if (!name) return false;
  return !NO_CARTRIDGE_SENTINELS.has(name.trim().toLowerCase());
};

/**
 * Detects whether the connected device can support CPU-state snapshots and
 * captures its firmware fingerprint.
 *
 * Gating mirrors the research: `/v1/info` must be reachable (it 404s on firmware
 * older than 3.12). `readmem`/`writemem`/`run_crt` — the primitives every path
 * relies on — are available on every firmware that answers `/v1/info`, so a
 * successful info read is the capability gate. The result is honest: when info
 * is unavailable we report `cpuSnapshotSupported: false` with a reason rather
 * than guessing.
 */
export const detectSnapshotCapability = async (api: CapabilityApi): Promise<SnapshotCapability> => {
  let info: DeviceInfo | null = null;
  let infoReason: string | undefined;
  try {
    info = await api.getInfo();
    if (hasErrors(info?.errors)) {
      infoReason = `/v1/info returned errors: ${info!.errors.join(", ")}`;
      info = null;
    }
  } catch (error) {
    infoReason = `/v1/info unavailable: ${(error as Error).message}`;
  }

  let apiVersion: string | undefined;
  try {
    const version = await api.getVersion();
    if (!hasErrors(version?.errors)) {
      apiVersion = version?.version;
    }
  } catch (error) {
    addErrorLog("Failed to read /v1/version for snapshot capability", {
      error: (error as Error).message,
    });
  }

  const firmware: FirmwareCapability = {
    product: info?.product,
    firmware_version: info?.firmware_version,
    fpga_version: info?.fpga_version,
    core_version: info?.core_version,
    api_version: apiVersion,
  };

  if (!info) {
    return {
      firmware,
      cpuSnapshotSupported: false,
      reason: infoReason ?? "device information is unavailable",
    };
  }

  return { firmware, cpuSnapshotSupported: true };
};

/** Pulls the selected value out of a single-item config response, defensively. */
const extractConfigItemValue = (response: ConfigResponse, category: string, item: string): string | undefined => {
  const categoryValue = response?.[category];
  if (!categoryValue || typeof categoryValue !== "object" || Array.isArray(categoryValue)) {
    return undefined;
  }
  const itemValue = (categoryValue as Record<string, unknown>)[item];
  if (itemValue == null) return undefined;
  if (typeof itemValue === "string") return itemValue;
  if (typeof itemValue === "number") return String(itemValue);
  if (typeof itemValue === "object") {
    const selected = (itemValue as { selected?: unknown }).selected;
    if (selected != null) return String(selected);
  }
  return undefined;
};

/**
 * Reads the configured cartridge so a snapshot can record cartridge context and
 * so restore can re-apply the user's cartridge afterward. Returns a best-effort
 * {@link CartridgeMeta}: the firmware exposes the configured *selection* only,
 * not live cartridge state, so `was_active` is a conservative inference.
 */
export const getCartridgeConfig = async (api: CapabilityApi): Promise<CartridgeMeta> => {
  let configuredName: string | undefined;
  try {
    const response = await api.getConfigItem(CARTRIDGE_CATEGORY, CARTRIDGE_ITEM);
    configuredName = extractConfigItemValue(response, CARTRIDGE_CATEGORY, CARTRIDGE_ITEM);
  } catch (error) {
    addErrorLog("Failed to read cartridge config for snapshot metadata", {
      error: (error as Error).message,
    });
  }

  const meaningful = isMeaningfulCartridge(configuredName);
  return {
    configured_name: meaningful ? configuredName : undefined,
    was_active: meaningful,
    ram_resident_assumed: true,
  };
};
