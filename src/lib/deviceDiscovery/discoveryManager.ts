/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { DeviceDiscovery, type NativeDeviceDiscoveryCandidate } from "@/lib/native/deviceDiscovery";
import { addLog, buildErrorLogDetails } from "@/lib/logging";
import { buildDeviceHostWithHttpPort } from "@/lib/c64api/hostConfig";
import {
  addSavedDevice,
  completeSavedDeviceVerification,
  getSavedDevicesSnapshot,
  resolveCanonicalProductFamilyCode,
  selectSavedDevice,
  updateSavedDevice,
} from "@/lib/savedDevices/store";
import {
  type DeviceDiscoveryCandidate,
  type DeviceDiscoveryResult,
  type DeviceDiscoveryState,
  type DeviceDiscoveryTrigger,
  type PersistedDiscoveredDevice,
} from "@/lib/deviceDiscovery/types";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CONNECT_TIMEOUT_MS = 650;
const DEFAULT_MAX_CONCURRENCY = 24;
const DEFAULT_HTTP_PORT = 80;
const DEFAULT_FTP_PORT = 21;
const DEFAULT_TELNET_PORT = 23;
const PRODUCT_HOST_CANDIDATES = [
  "c64u",
  "u64",
  "Ultimate",
  "Ultimate-II",
  "Ultimate-IIp",
  "Ultimate-IIpL",
  "Ultimate-64",
  "Ultimate-64-Elite",
  "Ultimate-64-II",
];

let state: DeviceDiscoveryState = Object.freeze({
  phase: "idle",
  trigger: null,
  startedAt: null,
  completedAt: null,
  candidates: [],
  scannedHosts: 0,
  elapsedMs: null,
  error: null,
  unsupported: false,
});
let activeDiscovery: Promise<DeviceDiscoveryResult> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

const setState = (patch: Partial<DeviceDiscoveryState>) => {
  state = Object.freeze({ ...state, ...patch });
  emit();
};

export const subscribeDeviceDiscovery = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getDeviceDiscoveryState = () => state;

export const resetDeviceDiscoveryStateForTests = () => {
  activeDiscovery = null;
  state = Object.freeze({
    phase: "idle",
    trigger: null,
    startedAt: null,
    completedAt: null,
    candidates: [],
    scannedHosts: 0,
    elapsedMs: null,
    error: null,
    unsupported: false,
  });
  emit();
};

const normalizeToken = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

const candidateKey = (candidate: NativeDeviceDiscoveryCandidate) => {
  const uniqueId = normalizeToken(candidate.uniqueId);
  if (uniqueId) return `id:${uniqueId}`;
  const hostname = normalizeToken(candidate.hostname);
  const product = normalizeToken(candidate.product);
  if (hostname && product) return `host-product:${hostname}:${product}`;
  return `address:${normalizeToken(candidate.address)}`;
};

const findSavedDeviceId = (candidate: NativeDeviceDiscoveryCandidate) => {
  const savedDevices = getSavedDevicesSnapshot();
  const uniqueId = normalizeToken(candidate.uniqueId);
  if (uniqueId) {
    const match = savedDevices.devices.find((device) => normalizeToken(device.lastKnownUniqueId) === uniqueId);
    if (match) return match.id;
  }
  const hostname = normalizeToken(candidate.hostname);
  if (hostname) {
    const match = savedDevices.devices.find(
      (device) => normalizeToken(device.lastKnownHostname) === hostname || normalizeToken(device.host) === hostname,
    );
    if (match) return match.id;
  }
  const address = normalizeToken(candidate.address);
  const host = normalizeToken(candidate.host);
  const match = savedDevices.devices.find(
    (device) => normalizeToken(device.host) === address || Boolean(host && normalizeToken(device.host) === host),
  );
  return match?.id ?? null;
};

const isUltimateProduct = (product: string | null | undefined) => {
  const normalized = normalizeToken(product).replace(/[^a-z0-9]+/g, "");
  return normalized.includes("ultimate") || normalized === "c64u";
};

const normalizeCandidate = (
  candidate: NativeDeviceDiscoveryCandidate,
  lastSeenAt: string,
): DeviceDiscoveryCandidate | null => {
  const requiresPassword = Boolean(candidate.requiresPassword);
  const product = candidate.product?.trim() || (requiresPassword ? "C64 Ultimate" : undefined);
  if (!product || !isUltimateProduct(product)) return null;
  const address = candidate.address.trim();
  if (!address) return null;
  const key = candidateKey(candidate);
  return {
    id: key,
    address,
    host: candidate.host?.trim() || null,
    httpPort: candidate.httpPort || DEFAULT_HTTP_PORT,
    source: Array.from(new Set(candidate.source.length ? candidate.source : ["lan-scan"])),
    product,
    firmwareVersion: candidate.firmwareVersion?.trim() || null,
    fpgaVersion: candidate.fpgaVersion?.trim() || null,
    coreVersion: candidate.coreVersion?.trim() || null,
    hostname: candidate.hostname?.trim() || null,
    uniqueId: candidate.uniqueId?.trim() || null,
    requiresPassword,
    alreadySavedDeviceId: findSavedDeviceId(candidate),
    confidence: "verified",
    lastSeenAt,
  };
};

export const rankDiscoveredCandidates = (candidates: DeviceDiscoveryCandidate[]) => {
  const savedDevices = getSavedDevicesSnapshot();
  const selected = savedDevices.devices.find((device) => device.id === savedDevices.selectedDeviceId) ?? null;
  return [...candidates].sort((left, right) => {
    const score = (candidate: DeviceDiscoveryCandidate) => {
      let value = 0;
      if (selected && candidate.alreadySavedDeviceId === selected.id) value += 1000;
      if (candidate.alreadySavedDeviceId) value += 500;
      if (candidate.uniqueId) value += 100;
      if (candidate.hostname) value += 50;
      if (candidate.source.includes("hostname")) value += 20;
      return value;
    };
    return score(right) - score(left) || left.address.localeCompare(right.address);
  });
};

const buildKnownHosts = () => {
  const savedDevices = getSavedDevicesSnapshot();
  const hosts = new Set<string>();
  for (const device of savedDevices.devices) {
    if (device.host.trim()) hosts.add(device.host.trim());
    if (device.lastKnownHostname?.trim()) hosts.add(device.lastKnownHostname.trim());
  }
  for (const host of PRODUCT_HOST_CANDIDATES) hosts.add(host);
  return Array.from(hosts);
};

type DiscoveryScanOptions = {
  trigger: DeviceDiscoveryTrigger;
  includeLanScan?: boolean;
  timeoutMs?: number;
};

// Run the native scan and normalise/dedupe/rank its candidates WITHOUT touching the
// shared discovery store. Both the public (state-publishing) and silent code paths go
// through this so the two stay in lockstep.
const scanAndResolveCandidates = async (
  options: DiscoveryScanOptions,
): Promise<{ resolved: DeviceDiscoveryResult; lastSeenAt: string }> => {
  // Platform coverage for the native bridge:
  // - Android: real bounded LAN scan + known-host probing (DeviceDiscoveryPlugin.kt).
  // - iOS: native plugin resolves a graceful `unsupported` result (no LAN scan yet).
  // - Web: the registered web facade resolves `unsupported`.
  // So callers always get a well-formed result with `unsupported` set rather than a
  // rejected promise; no JS-side platform gate is needed here.
  const result = await DeviceDiscovery.discover({
    knownHosts: buildKnownHosts(),
    includeLanScan: options.includeLanScan ?? true,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
    maxConcurrency: DEFAULT_MAX_CONCURRENCY,
  });
  const lastSeenAt = new Date().toISOString();
  const deduped = new Map<string, DeviceDiscoveryCandidate>();
  for (const nativeCandidate of result.candidates ?? []) {
    const normalized = normalizeCandidate(nativeCandidate, lastSeenAt);
    if (!normalized) continue;
    const existing = deduped.get(normalized.id);
    if (existing) {
      deduped.set(normalized.id, {
        ...existing,
        source: Array.from(new Set([...existing.source, ...normalized.source])),
      });
    } else {
      deduped.set(normalized.id, normalized);
    }
  }
  const candidates = rankDiscoveredCandidates(Array.from(deduped.values()));
  return {
    lastSeenAt,
    resolved: {
      candidates,
      scannedHosts: result.scannedHosts ?? 0,
      elapsedMs: result.elapsedMs ?? 0,
      unsupported: Boolean(result.unsupported),
    },
  };
};

export async function startDeviceDiscovery(
  options: DiscoveryScanOptions & {
    /**
     * Run the scan WITHOUT publishing to the shared discovery store or claiming the
     * single-flight slot. Used by the save-time IP-rescue scan so pressing Save can
     * never flip the Settings "Discover devices" UI into a scanning state the user
     * never initiated, nor adopt/derail a discovery the user actually started.
     */
    silent?: boolean;
  },
): Promise<DeviceDiscoveryResult> {
  if (options.silent) {
    try {
      const { resolved } = await scanAndResolveCandidates(options);
      addLog("info", "Silent device discovery completed", {
        trigger: options.trigger,
        candidates: resolved.candidates.length,
        scannedHosts: resolved.scannedHosts,
        unsupported: resolved.unsupported,
      });
      return resolved;
    } catch (error) {
      addLog(
        "warn",
        "Silent device discovery failed",
        buildErrorLogDetails(error as Error, { trigger: options.trigger }),
      );
      return { candidates: [], scannedHosts: 0, elapsedMs: 0, unsupported: false };
    }
  }

  if (activeDiscovery) return activeDiscovery;

  const startedAt = new Date().toISOString();
  setState({
    phase: "scanning",
    trigger: options.trigger,
    startedAt,
    completedAt: null,
    candidates: [],
    scannedHosts: 0,
    elapsedMs: null,
    error: null,
    unsupported: false,
  });

  activeDiscovery = (async () => {
    try {
      const { resolved, lastSeenAt } = await scanAndResolveCandidates(options);
      setState({
        phase: "complete",
        completedAt: lastSeenAt,
        candidates: resolved.candidates,
        scannedHosts: resolved.scannedHosts,
        elapsedMs: resolved.elapsedMs,
        unsupported: resolved.unsupported,
      });
      addLog("info", "Device discovery completed", {
        trigger: options.trigger,
        candidates: resolved.candidates.length,
        scannedHosts: resolved.scannedHosts,
        unsupported: resolved.unsupported,
      });
      return resolved;
    } catch (error) {
      const message = (error as Error).message || "Device discovery failed";
      setState({
        phase: "error",
        completedAt: new Date().toISOString(),
        error: message,
      });
      addLog("warn", "Device discovery failed", buildErrorLogDetails(error as Error, { trigger: options.trigger }));
      return {
        candidates: [],
        scannedHosts: 0,
        elapsedMs: 0,
        unsupported: false,
      };
    } finally {
      activeDiscovery = null;
    }
  })();

  return activeDiscovery;
}

export const persistDiscoveredDevice = (
  candidate: DeviceDiscoveryCandidate,
  options: { select?: boolean; passwordPresent?: boolean } = {},
): PersistedDiscoveredDevice => {
  const savedDevices = getSavedDevicesSnapshot();
  const product = resolveCanonicalProductFamilyCode(candidate.product);
  // HARD12-019: two devices can leave the factory sharing the same default
  // hostname (e.g. "c64u"). When both the saved device and the candidate
  // carry unique ids and those ids differ, the hostname/address matchers
  // would otherwise silently retarget device A's stored credentials to the
  // physically different device B. Refuse the match in that case — create
  // a fresh saved device entry.
  const matchesByUniqueId = (device: { lastKnownUniqueId?: string | null }) =>
    candidate.uniqueId &&
    device.lastKnownUniqueId &&
    normalizeToken(device.lastKnownUniqueId) === normalizeToken(candidate.uniqueId);
  const isConflictingHostnameMatch = (device: {
    lastKnownUniqueId?: string | null;
    host?: string;
    lastKnownHostname?: string | null;
  }) => {
    if (!candidate.hostname) return false;
    const hostnameMatchesSaved =
      normalizeToken(device.lastKnownHostname) === normalizeToken(candidate.hostname) ||
      normalizeToken(device.host) === normalizeToken(candidate.hostname);
    if (!hostnameMatchesSaved) return false;
    const savedUid = device.lastKnownUniqueId ? normalizeToken(device.lastKnownUniqueId) : null;
    const candidateUid = candidate.uniqueId ? normalizeToken(candidate.uniqueId) : null;
    return Boolean(savedUid && candidateUid && savedUid !== candidateUid);
  };
  const hostnameOrHostMatch = (device: { lastKnownHostname?: string | null; host?: string }) => {
    if (!candidate.hostname) return false;
    return (
      normalizeToken(device.lastKnownHostname) === normalizeToken(candidate.hostname) ||
      normalizeToken(device.host) === normalizeToken(candidate.hostname)
    );
  };
  const existingId =
    candidate.alreadySavedDeviceId ??
    (candidate.uniqueId ? (savedDevices.devices.find(matchesByUniqueId)?.id ?? null) : null) ??
    (candidate.hostname
      ? (savedDevices.devices.find((device) => hostnameOrHostMatch(device) && !isConflictingHostnameMatch(device))
          ?.id ?? null)
      : null) ??
    (candidate.address
      ? (savedDevices.devices.find(
          (device) =>
            normalizeToken(device.host) === normalizeToken(candidate.address) && !isConflictingHostnameMatch(device),
        )?.id ?? null)
      : null);
  const deviceId =
    existingId ??
    ((typeof crypto !== "undefined" && "randomUUID" in crypto && crypto.randomUUID()) ||
      `discovered-${Date.now().toString(36)}`);
  const host = candidate.address;
  const httpPort = candidate.httpPort || DEFAULT_HTTP_PORT;

  if (existingId) {
    updateSavedDevice(existingId, {
      host,
      httpPort,
      lastKnownProduct: product,
      lastKnownHostname: candidate.hostname,
      lastKnownUniqueId: candidate.uniqueId,
      ...(options.passwordPresent ? { hasPassword: true } : {}),
    });
  } else {
    addSavedDevice({
      id: deviceId,
      name: "",
      host,
      type: product ?? "",
      typeSource: "INFERRED",
      httpPort,
      ftpPort: DEFAULT_FTP_PORT,
      telnetPort: DEFAULT_TELNET_PORT,
      lastKnownProduct: product,
      lastKnownHostname: candidate.hostname,
      lastKnownUniqueId: candidate.uniqueId,
      hasPassword: Boolean(options.passwordPresent),
    });
  }

  completeSavedDeviceVerification(
    deviceId,
    {
      product: candidate.product,
      hostname: candidate.hostname,
      unique_id: candidate.uniqueId,
    },
    candidate.address,
  );
  if (options.select) {
    selectSavedDevice(deviceId);
  }

  return {
    deviceId,
    host,
    httpPort,
    deviceHost: buildDeviceHostWithHttpPort(host, httpPort),
  };
};
