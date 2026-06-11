/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { inferConnectedDeviceLabel } from "@/lib/diagnostics/targetDisplayMapper";
import {
  buildInferredSavedDeviceName,
  DEFAULT_SAVED_DEVICE_HOST,
  DEFAULT_SAVED_DEVICE_HTTP_PORT,
  normalizeSavedDeviceHostInput,
  splitSavedDeviceHostAndHttpPort,
  stripSavedDeviceHttpPort,
} from "@/lib/savedDevices/host";
import { sanitizeSavedDeviceNameInput } from "@/lib/savedDevices/deviceEditor";
import { TELNET_DEFAULT_PORT as DEFAULT_TELNET_PORT } from "@/lib/telnet/telnetTypes";
import type { DiagnosticsDeviceAttribution } from "@/lib/diagnostics/deviceAttribution";
import { addLog, buildErrorLogDetails } from "@/lib/logging";

export type ProductFamilyCode = "C64U" | "U64" | "U64E" | "U64E2";

export type SavedDeviceFieldSource = "INFERRED" | "USER";

type SavedDeviceSourceInput = SavedDeviceFieldSource | "auto" | "custom";

export type SavedDevice = {
  id: string;
  name: string;
  nameSource?: SavedDeviceSourceInput;
  host: string;
  type?: string;
  typeSource?: SavedDeviceSourceInput;
  httpPort: number;
  ftpPort: number;
  telnetPort: number;
  lastKnownProduct: ProductFamilyCode | null;
  lastKnownHostname: string | null;
  lastKnownUniqueId: string | null;
  lastSuccessfulConnectionAt: string | null;
  lastUsedAt: string | null;
  hasPassword: boolean;
};

export type SavedDeviceState = {
  selectedDeviceId: string;
  devices: SavedDevice[];
};

export type DeviceSwitchStatus = "connected" | "verifying" | "offline" | "mismatch" | "last-known";

export type DeviceSwitchSummary = {
  deviceId: string;
  verifiedAt: string | null;
  lastHealthState: string | null;
  lastConnectivityState: string | null;
  lastProbeSucceededAt: string | null;
  lastProbeFailedAt: string | null;
  lastVerifiedProduct: ProductFamilyCode | null;
  lastVerifiedHostname: string | null;
  lastVerifiedUniqueId: string | null;
  lastResolvedAddress: string | null;
};

export type VerifiedSavedDeviceIdentity = {
  product: ProductFamilyCode | null;
  hostname: string | null;
  uniqueId: string | null;
};

type PersistedSavedDevicesEnvelope = {
  version: 1;
  selectedDeviceId: string;
  devices: SavedDevice[];
  summaries: Record<string, DeviceSwitchSummary>;
  summaryLru: string[];
  hasEverHadMultipleDevices: boolean;
};

export type SavedDevicesSnapshot = {
  selectedDeviceId: string;
  devices: SavedDevice[];
  summaries: Record<string, DeviceSwitchSummary>;
  summaryLru: string[];
  hasEverHadMultipleDevices: boolean;
  runtimeStatuses: Record<string, DeviceSwitchStatus>;
  verifiedByDeviceId: Record<string, VerifiedSavedDeviceIdentity | null>;
  actualDeviceIdByDeviceId: Record<string, string | null>;
};

const STORAGE_KEY = "c64u_saved_devices:v1";
const EVENT_NAME = "c64u-saved-devices-change";
const DEVICE_SAFETY_UPDATE_EVENT = "c64u-device-safety-updated";
const LEGACY_DEVICE_HOST_KEY = "c64u_device_host";
const LEGACY_BASE_URL_KEY = "c64u_base_url";
const LEGACY_FTP_PORT_KEY = "c64u_ftp_port";
const LEGACY_TELNET_PORT_KEY = "c64u_telnet_port";
const LEGACY_HAS_PASSWORD_KEY = "c64u_has_password";
const DEFAULT_DEVICE_HOST = DEFAULT_SAVED_DEVICE_HOST;
const DEFAULT_HTTP_PORT = DEFAULT_SAVED_DEVICE_HTTP_PORT;
const DEFAULT_FTP_PORT = 21;
const SUMMARY_NON_SELECTED_LIMIT = 3;

const listeners = new Set<() => void>();

let snapshot: SavedDevicesSnapshot | null = null;

type DebugSavedDeviceBootstrapInput = {
  id?: unknown;
  name?: unknown;
  nameSource?: unknown;
  host?: unknown;
  type?: unknown;
  typeSource?: unknown;
  httpPort?: unknown;
  ftpPort?: unknown;
  telnetPort?: unknown;
  hasPassword?: unknown;
};

const compact = (value: string) => value.replace(/[^a-z0-9]+/gi, "");

const normalizeSavedDeviceUserName = (name: string | null | undefined) => sanitizeSavedDeviceNameInput(name ?? "");
const normalizeSavedDeviceType = (value: string | null | undefined) => value?.trim() ?? "";
const normalizeSavedDeviceSourceInput = (source?: SavedDeviceSourceInput | null): SavedDeviceFieldSource | null => {
  if (source === "USER" || source === "custom") return "USER";
  if (source === "INFERRED" || source === "auto") return "INFERRED";
  return null;
};

const resolveSavedDeviceNameSource = (
  name: string,
  host: string,
  nameSource?: SavedDevice["nameSource"],
): SavedDeviceFieldSource => {
  const normalizedSource = normalizeSavedDeviceSourceInput(nameSource);
  if (normalizedSource === "USER" && name) return "USER";
  if (normalizedSource === "INFERRED") return "INFERRED";
  if (!name) return "INFERRED";
  return compact(name).toLowerCase() === compact(host).toLowerCase() ? "INFERRED" : "USER";
};

const resolveSavedDeviceTypeSource = (
  type: string,
  lastKnownProduct: ProductFamilyCode | null,
  typeSource?: SavedDevice["typeSource"],
): SavedDeviceFieldSource => {
  const normalizedSource = normalizeSavedDeviceSourceInput(typeSource);
  if (normalizedSource === "USER" && type) return "USER";
  if (normalizedSource === "INFERRED") return "INFERRED";
  if (!type) return "INFERRED";
  return lastKnownProduct && type === lastKnownProduct ? "INFERRED" : "USER";
};

const resolveSavedDeviceStoredName = (
  name: string | null | undefined,
  host: string,
  nameSource?: SavedDevice["nameSource"],
) => {
  const normalizedHost = normalizeSavedDeviceHostInput(host);
  const normalizedName = normalizeSavedDeviceUserName(name);
  const resolvedSource = resolveSavedDeviceNameSource(normalizedName, normalizedHost, nameSource);
  return {
    name: resolvedSource === "USER" ? normalizedName : buildInferredSavedDeviceName(normalizedHost),
    nameSource: resolvedSource,
  };
};

const resolveSavedDeviceStoredType = (
  type: string | null | undefined,
  lastKnownProduct: ProductFamilyCode | null,
  typeSource?: SavedDevice["typeSource"],
) => {
  const normalizedType = normalizeSavedDeviceType(type);
  const resolvedSource = resolveSavedDeviceTypeSource(normalizedType, lastKnownProduct, typeSource);
  return {
    type: resolvedSource === "USER" ? normalizedType : normalizedType || lastKnownProduct || "",
    typeSource: resolvedSource,
  };
};

const parsePort = (value: string | null | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
  return parsed;
};

const buildDeviceHost = (host: string, httpPort: number) => {
  const normalizedHost = normalizeSavedDeviceHostInput(host);
  if (httpPort === DEFAULT_HTTP_PORT) return normalizedHost;
  const bracketed =
    normalizedHost.includes(":") && !normalizedHost.startsWith("[") ? `[${normalizedHost}]` : normalizedHost;
  return `${bracketed}:${httpPort}`;
};

const createId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto && crypto.randomUUID()) ||
  `${Date.now().toString(36)}-${Math.round(Math.random() * 1e9).toString(36)}`;

const isSavedDeviceCustomNamed = (device: SavedDevice) => {
  const normalizedName = normalizeSavedDeviceUserName(device.name);
  if (!normalizedName) return false;
  return resolveSavedDeviceNameSource(normalizedName, device.host, device.nameSource) === "USER";
};

const getSavedDeviceStoredName = (device: SavedDevice) =>
  resolveSavedDeviceStoredName(device.name, device.host, device.nameSource).name;

const buildSavedDeviceLabelMap = (
  devices: SavedDevice[],
  verifiedByDeviceId: Record<string, VerifiedSavedDeviceIdentity | null> = {},
) => {
  const labels = new Map<string, string>();
  const used = new Set<string>();

  devices.forEach((device) => {
    if (isSavedDeviceCustomNamed(device)) {
      const label = normalizeSavedDeviceUserName(device.name);
      labels.set(device.id, label);
      used.add(label.toLowerCase());
      return;
    }

    const baseLabel = getSavedDeviceStoredName(device);
    let candidate = baseLabel;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${baseLabel}-${suffix}`;
      suffix += 1;
    }
    labels.set(device.id, candidate);
    used.add(candidate.toLowerCase());
  });

  return labels;
};

const resolveSavedDeviceLabel = (
  device: SavedDevice,
  devices: SavedDevice[],
  verifiedByDeviceId: Record<string, VerifiedSavedDeviceIdentity | null> = {},
) => buildSavedDeviceLabelMap(devices, verifiedByDeviceId).get(device.id) ?? getSavedDeviceStoredName(device);

const isPasswordFlagSet = () => {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(LEGACY_HAS_PASSWORD_KEY) === "1";
};

const parseEnvelope = (raw: string | null): PersistedSavedDevicesEnvelope | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSavedDevicesEnvelope> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.devices) || typeof parsed.selectedDeviceId !== "string") return null;
    const devices = parsed.devices.filter((device): device is SavedDevice => {
      return Boolean(device && typeof device === "object" && typeof device.id === "string");
    });
    if (!devices.length) return null;
    const selectedDeviceId = devices.some((device) => device.id === parsed.selectedDeviceId)
      ? parsed.selectedDeviceId
      : devices[0].id;
    return {
      version: 1,
      selectedDeviceId,
      devices: devices.map((device) => ({
        id: device.id,
        host: normalizeSavedDeviceHostInput(device.host),
        ...resolveSavedDeviceStoredName(
          typeof device.name === "string" ? device.name : "",
          device.host,
          device.nameSource,
        ),
        ...resolveSavedDeviceStoredType(
          typeof device.type === "string" ? device.type : device.lastKnownProduct,
          device.lastKnownProduct ?? null,
          device.typeSource,
        ),
        httpPort: parsePort(String(device.httpPort ?? ""), DEFAULT_HTTP_PORT),
        ftpPort: parsePort(String(device.ftpPort ?? ""), DEFAULT_FTP_PORT),
        telnetPort: parsePort(String(device.telnetPort ?? ""), DEFAULT_TELNET_PORT),
        lastKnownProduct: device.lastKnownProduct ?? null,
        lastKnownHostname: device.lastKnownHostname ?? null,
        lastKnownUniqueId: device.lastKnownUniqueId ?? null,
        lastSuccessfulConnectionAt: device.lastSuccessfulConnectionAt ?? null,
        lastUsedAt: device.lastUsedAt ?? null,
        hasPassword: Boolean(device.hasPassword),
      })),
      summaries:
        parsed.summaries && typeof parsed.summaries === "object"
          ? Object.fromEntries(
              Object.entries(parsed.summaries).map(([deviceId, summary]) => [
                deviceId,
                {
                  deviceId,
                  verifiedAt: summary?.verifiedAt ?? null,
                  lastHealthState: summary?.lastHealthState ?? null,
                  lastConnectivityState: summary?.lastConnectivityState ?? null,
                  lastProbeSucceededAt: summary?.lastProbeSucceededAt ?? null,
                  lastProbeFailedAt: summary?.lastProbeFailedAt ?? null,
                  lastVerifiedProduct: summary?.lastVerifiedProduct ?? null,
                  lastVerifiedHostname: summary?.lastVerifiedHostname ?? null,
                  lastVerifiedUniqueId: summary?.lastVerifiedUniqueId ?? null,
                  lastResolvedAddress: summary?.lastResolvedAddress ?? null,
                } satisfies DeviceSwitchSummary,
              ]),
            )
          : {},
      summaryLru: Array.isArray(parsed.summaryLru)
        ? parsed.summaryLru.filter((entry): entry is string => typeof entry === "string")
        : [],
      hasEverHadMultipleDevices: Boolean(parsed.hasEverHadMultipleDevices) || devices.length > 1,
    };
  } catch (error) {
    // Corrupted envelope is not normal operation; surface it before we silently
    // drop user-curated saved devices and rebuild from legacy/localStorage scraps.
    addLog(
      "warn",
      "Failed to parse persisted saved-devices envelope; falling back to legacy initialization.",
      buildErrorLogDetails(error as Error, { storageKey: STORAGE_KEY }),
    );
    return null;
  }
};

const createLegacyDevice = (): SavedDevice => {
  const storedHost = typeof localStorage === "undefined" ? null : localStorage.getItem(LEGACY_DEVICE_HOST_KEY);
  const legacyBaseUrl = typeof localStorage === "undefined" ? null : localStorage.getItem(LEGACY_BASE_URL_KEY);
  const resolvedHost = storedHost || legacyBaseUrl || DEFAULT_DEVICE_HOST;
  const { host, httpPort } = splitSavedDeviceHostAndHttpPort(resolvedHost);
  return {
    id: createId(),
    name: host,
    nameSource: "INFERRED",
    host,
    type: "",
    typeSource: "INFERRED",
    httpPort,
    ftpPort: parsePort(
      typeof localStorage === "undefined" ? null : localStorage.getItem(LEGACY_FTP_PORT_KEY),
      DEFAULT_FTP_PORT,
    ),
    telnetPort: parsePort(
      typeof localStorage === "undefined" ? null : localStorage.getItem(LEGACY_TELNET_PORT_KEY),
      DEFAULT_TELNET_PORT,
    ),
    lastKnownProduct: null,
    lastKnownHostname: null,
    lastKnownUniqueId: null,
    lastSuccessfulConnectionAt: null,
    lastUsedAt: null,
    hasPassword: isPasswordFlagSet(),
  };
};

const readDebugSavedDevicesEnv = (): string | undefined => {
  try {
    if (typeof import.meta === "undefined" || !import.meta.env) return undefined;
    const value = import.meta.env.VITE_DEBUG_SAVED_DEVICES_JSON;
    return typeof value === "string" ? value : undefined;
  } catch (error) {
    addLog("debug", "Failed to read VITE_DEBUG_SAVED_DEVICES_JSON", buildErrorLogDetails(error as Error));
    return undefined;
  }
};

const createDebugBootstrapDevices = (): SavedDevice[] | null => {
  const raw = readDebugSavedDevicesEnv();
  if (!raw?.trim()) return null;

  try {
    const parsed = JSON.parse(raw) as DebugSavedDeviceBootstrapInput[] | null;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const seenIds = new Set<string>();
    const devices = parsed.flatMap((entry, index) => {
      if (!entry || typeof entry !== "object") return [];

      const host = normalizeSavedDeviceHostInput(typeof entry.host === "string" ? entry.host : "");
      if (!host) return [];

      let id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `debug-device-${index + 1}`;
      if (seenIds.has(id)) {
        id = `${id}-${index + 1}`;
      }
      seenIds.add(id);

      return [
        {
          id,
          host,
          ...resolveSavedDeviceStoredName(
            typeof entry.name === "string" ? entry.name : "",
            host,
            typeof entry.nameSource === "string" ? (entry.nameSource as SavedDeviceSourceInput) : undefined,
          ),
          ...resolveSavedDeviceStoredType(
            typeof entry.type === "string" ? entry.type : "",
            null,
            typeof entry.typeSource === "string" ? (entry.typeSource as SavedDeviceSourceInput) : undefined,
          ),
          httpPort: parsePort(String(entry.httpPort ?? ""), DEFAULT_HTTP_PORT),
          ftpPort: parsePort(String(entry.ftpPort ?? ""), DEFAULT_FTP_PORT),
          telnetPort: parsePort(String(entry.telnetPort ?? ""), DEFAULT_TELNET_PORT),
          lastKnownProduct: null,
          lastKnownHostname: null,
          lastKnownUniqueId: null,
          lastSuccessfulConnectionAt: null,
          lastUsedAt: null,
          hasPassword: Boolean(entry.hasPassword),
        } satisfies SavedDevice,
      ];
    });

    return devices.length > 0 ? devices : null;
  } catch (error) {
    addLog("warn", "Failed to parse debug saved devices bootstrap", buildErrorLogDetails(error as Error));
    return null;
  }
};

const createInitialEnvelope = (): PersistedSavedDevicesEnvelope => {
  const debugBootstrapDevices = createDebugBootstrapDevices();
  if (debugBootstrapDevices) {
    return {
      version: 1,
      selectedDeviceId: debugBootstrapDevices[0]!.id,
      devices: debugBootstrapDevices,
      summaries: {},
      summaryLru: [],
      hasEverHadMultipleDevices: debugBootstrapDevices.length > 1,
    };
  }

  const device = createLegacyDevice();
  return {
    version: 1,
    selectedDeviceId: device.id,
    devices: [device],
    summaries: {},
    summaryLru: [],
    hasEverHadMultipleDevices: false,
  };
};

const normalizeEnvelope = (envelope: PersistedSavedDevicesEnvelope): PersistedSavedDevicesEnvelope => {
  const selectedDeviceId = envelope.devices.some((device) => device.id === envelope.selectedDeviceId)
    ? envelope.selectedDeviceId
    : (envelope.devices[0]?.id ?? createLegacyDevice().id);
  const seen = new Set<string>();
  const summaryLru = envelope.summaryLru.filter((deviceId) => {
    if (seen.has(deviceId)) return false;
    seen.add(deviceId);
    return Boolean(envelope.devices.find((device) => device.id === deviceId));
  });
  return {
    ...envelope,
    selectedDeviceId,
    devices: envelope.devices,
    summaryLru,
    hasEverHadMultipleDevices: envelope.hasEverHadMultipleDevices || envelope.devices.length > 1,
  };
};

const selectedDeviceFromEnvelope = (envelope: PersistedSavedDevicesEnvelope) =>
  envelope.devices.find((device) => device.id === envelope.selectedDeviceId) ?? envelope.devices[0] ?? null;

const buildSnapshot = (envelope: PersistedSavedDevicesEnvelope): SavedDevicesSnapshot => ({
  selectedDeviceId: envelope.selectedDeviceId,
  devices: envelope.devices,
  summaries: envelope.summaries,
  summaryLru: envelope.summaryLru,
  hasEverHadMultipleDevices: envelope.hasEverHadMultipleDevices,
  runtimeStatuses: snapshot?.runtimeStatuses ?? {},
  verifiedByDeviceId: snapshot?.verifiedByDeviceId ?? {},
  actualDeviceIdByDeviceId: snapshot?.actualDeviceIdByDeviceId ?? {},
});

const emit = () => {
  listeners.forEach((listener) => listener());
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  }
};

const broadcastSafetyConfigUpdate = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DEVICE_SAFETY_UPDATE_EVENT, { detail: { key, value } }));
};

const persistEnvelope = (envelope: PersistedSavedDevicesEnvelope) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  }
  snapshot = buildSnapshot(envelope);
  emit();
};

const loadEnvelope = () => {
  if (snapshot) {
    return {
      version: 1 as const,
      selectedDeviceId: snapshot.selectedDeviceId,
      devices: snapshot.devices,
      summaries: snapshot.summaries,
      summaryLru: snapshot.summaryLru,
      hasEverHadMultipleDevices: snapshot.hasEverHadMultipleDevices,
    } satisfies PersistedSavedDevicesEnvelope;
  }
  const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  const parsed = parseEnvelope(raw) ?? createInitialEnvelope();
  const normalized = normalizeEnvelope(parsed);
  snapshot = buildSnapshot(normalized);
  if (typeof localStorage !== "undefined" && raw !== JSON.stringify(normalized)) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
};

const updateSnapshot = (
  update: (
    envelope: PersistedSavedDevicesEnvelope,
    currentSnapshot: SavedDevicesSnapshot,
  ) => PersistedSavedDevicesEnvelope,
) => {
  const envelope = loadEnvelope();
  const currentSnapshot = snapshot ?? buildSnapshot(envelope);
  const nextEnvelope = normalizeEnvelope(update(envelope, currentSnapshot));
  persistEnvelope(nextEnvelope);
  return snapshot as SavedDevicesSnapshot;
};

const updateRuntime = (update: (currentSnapshot: SavedDevicesSnapshot) => SavedDevicesSnapshot) => {
  const envelope = loadEnvelope();
  const currentSnapshot = snapshot ?? buildSnapshot(envelope);
  snapshot = update(currentSnapshot);
  emit();
  return snapshot;
};

const resetSavedDeviceSummaryVerification = (summary: DeviceSwitchSummary): DeviceSwitchSummary => ({
  ...summary,
  verifiedAt: null,
  lastHealthState: null,
  lastConnectivityState: null,
  lastProbeSucceededAt: null,
  lastProbeFailedAt: null,
  lastVerifiedProduct: null,
  lastVerifiedHostname: null,
  lastVerifiedUniqueId: null,
  lastResolvedAddress: null,
});

const summaryStamp = (summary: DeviceSwitchSummary): string =>
  summary.lastProbeSucceededAt ?? summary.lastProbeFailedAt ?? summary.verifiedAt ?? "";

export const resolveCanonicalProductFamilyCode = (product?: string | null): ProductFamilyCode | null => {
  return inferConnectedDeviceLabel(product ?? null) ?? null;
};

const inferSavedDeviceProductFamily = (device: SavedDevice): ProductFamilyCode | null => {
  const typedProduct = resolveCanonicalProductFamilyCode(device.type);
  if (typedProduct) return typedProduct;

  const identifiers = [device.host, device.name].map((value) => compact(value).toLowerCase());
  if (identifiers.some((value) => value === "c64u" || value === "c64ultimate")) {
    return "C64U";
  }
  return null;
};

export const buildSavedDevicePrimaryLabel = (device: SavedDevice, verified?: VerifiedSavedDeviceIdentity | null) => {
  const currentSnapshot = snapshot;
  if (!currentSnapshot) {
    return resolveSavedDeviceLabel(device, [device], verified ? { [device.id]: verified } : {});
  }
  const devices = currentSnapshot.devices.some((entry) => entry.id === device.id)
    ? currentSnapshot.devices
    : [...currentSnapshot.devices, device];
  const verifiedByDeviceId = {
    ...currentSnapshot.verifiedByDeviceId,
    ...(verified ? { [device.id]: verified } : {}),
  };
  return resolveSavedDeviceLabel(device, devices, verifiedByDeviceId);
};

export const validateSavedDeviceName = (devices: SavedDevice[], deviceId: string, name: string, host: string) => {
  const normalizedHost = normalizeSavedDeviceHostInput(host);
  const normalizedName = normalizeSavedDeviceUserName(name);
  const currentLabels = buildSavedDeviceLabelMap(devices);
  const reservedVisibleLabel =
    normalizedName !== "" &&
    devices.some(
      (device) =>
        device.id !== deviceId &&
        (currentLabels.get(device.id)?.trim().toLowerCase() ?? "") === normalizedName.toLowerCase(),
    );
  const existingDevice = devices.find((device) => device.id === deviceId) ?? null;
  const nextNameSource = resolveSavedDeviceNameSource(
    normalizedName,
    normalizedHost,
    normalizedName ? "USER" : "INFERRED",
  );
  const nextName = nextNameSource === "USER" ? normalizedName : buildInferredSavedDeviceName(normalizedHost);
  const candidateDevice: SavedDevice = existingDevice
    ? {
        ...existingDevice,
        host: normalizedHost,
        name: nextName,
        nameSource: nextNameSource,
      }
    : {
        id: deviceId,
        name: nextName,
        nameSource: nextNameSource,
        host: normalizedHost,
        type: "",
        typeSource: "INFERRED",
        httpPort: DEFAULT_HTTP_PORT,
        ftpPort: DEFAULT_FTP_PORT,
        telnetPort: DEFAULT_TELNET_PORT,
        lastKnownProduct: null,
        lastKnownHostname: null,
        lastKnownUniqueId: null,
        lastSuccessfulConnectionAt: null,
        lastUsedAt: null,
        hasPassword: false,
      };
  const nextDevices = existingDevice
    ? devices.map((device) => (device.id === deviceId ? candidateDevice : device))
    : [...devices, candidateDevice];
  const labels = buildSavedDeviceLabelMap(nextDevices);
  const candidateLabel = labels.get(deviceId)?.trim().toLowerCase() ?? "";
  if (!candidateLabel) return "Device name is required.";
  const duplicate = nextDevices.some(
    (device) => device.id !== deviceId && (labels.get(device.id)?.trim().toLowerCase() ?? "") === candidateLabel,
  );
  if (duplicate || reservedVisibleLabel) {
    return "Device name must be unique.";
  }
  return null;
};

const buildExpectedIdentity = (device: SavedDevice) => {
  if (device.lastKnownUniqueId) {
    return { kind: "uniqueId" as const, value: device.lastKnownUniqueId };
  }
  if (device.lastKnownHostname && device.lastKnownProduct) {
    return {
      kind: "host-product" as const,
      hostname: device.lastKnownHostname.toLowerCase(),
      product: device.lastKnownProduct,
    };
  }
  return { kind: "unverified" as const };
};

const resolveMismatch = (device: SavedDevice, verified: VerifiedSavedDeviceIdentity) => {
  const expected = buildExpectedIdentity(device);
  if (expected.kind === "uniqueId") {
    return Boolean(verified.uniqueId && verified.uniqueId !== expected.value);
  }
  if (expected.kind === "host-product") {
    if (verified.hostname && verified.product) {
      return verified.hostname.toLowerCase() !== expected.hostname || verified.product !== expected.product;
    }
    return false;
  }
  return false;
};

const touchSummaryLru = (envelope: PersistedSavedDevicesEnvelope, deviceId: string) => {
  const next = [deviceId, ...envelope.summaryLru.filter((entry) => entry !== deviceId)];
  const selectedDeviceId = envelope.selectedDeviceId;
  const selected = selectedDeviceId ? [selectedDeviceId] : [];
  const otherEntries = next.filter((entry) => entry !== selectedDeviceId).slice(0, SUMMARY_NON_SELECTED_LIMIT);
  const keepIds = new Set([...selected, ...otherEntries]);
  envelope.summaryLru = [...selected, ...otherEntries];
  envelope.summaries = Object.fromEntries(
    Object.entries(envelope.summaries).filter(([summaryDeviceId]) => keepIds.has(summaryDeviceId)),
  );
};

export const subscribeSavedDevices = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getSavedDevicesSnapshot = (): SavedDevicesSnapshot => {
  loadEnvelope();
  return snapshot as SavedDevicesSnapshot;
};

export const getSavedDevicesStorageKey = () => STORAGE_KEY;

export const getSelectedSavedDevice = () => {
  const current = getSavedDevicesSnapshot();
  return current.devices.find((device) => device.id === current.selectedDeviceId) ?? current.devices[0] ?? null;
};

export const getSelectedSavedDeviceProductFamilySync = (): ProductFamilyCode | null => {
  const current = getSavedDevicesSnapshot();
  const selectedDevice =
    current.devices.find((device) => device.id === current.selectedDeviceId) ?? current.devices[0] ?? null;
  if (!selectedDevice) return null;
  return (
    current.verifiedByDeviceId[selectedDevice.id]?.product ??
    selectedDevice.lastKnownProduct ??
    current.summaries[selectedDevice.id]?.lastVerifiedProduct ??
    inferSavedDeviceProductFamily(selectedDevice) ??
    null
  );
};

export const getSavedDeviceById = (deviceId: string) => {
  const current = getSavedDevicesSnapshot();
  return current.devices.find((device) => device.id === deviceId) ?? null;
};

export const addSavedDevice = (
  draft: Omit<SavedDevice, "id" | "lastSuccessfulConnectionAt" | "lastUsedAt"> & { id?: string },
) => {
  return updateSnapshot((envelope) => {
    const host = normalizeSavedDeviceHostInput(draft.host);
    const nextName = resolveSavedDeviceStoredName(draft.name, host, draft.nameSource);
    const nextType = resolveSavedDeviceStoredType(draft.type, draft.lastKnownProduct ?? null, draft.typeSource);
    const nextDevice: SavedDevice = {
      id: draft.id ?? createId(),
      name: nextName.name,
      nameSource: nextName.nameSource,
      host,
      type: nextType.type,
      typeSource: nextType.typeSource,
      httpPort: draft.httpPort,
      ftpPort: draft.ftpPort,
      telnetPort: draft.telnetPort,
      lastKnownProduct: draft.lastKnownProduct ?? null,
      lastKnownHostname: draft.lastKnownHostname ?? null,
      lastKnownUniqueId: draft.lastKnownUniqueId ?? null,
      lastSuccessfulConnectionAt: null,
      lastUsedAt: null,
      hasPassword: Boolean(draft.hasPassword),
    };
    return {
      ...envelope,
      devices: [...envelope.devices, nextDevice],
      hasEverHadMultipleDevices: envelope.hasEverHadMultipleDevices || envelope.devices.length + 1 > 1,
    };
  });
};

export const updateSavedDevice = (deviceId: string, update: Partial<Omit<SavedDevice, "id">>) => {
  return updateSnapshot((envelope) => {
    let clearSummary = false;
    const nextDevices = envelope.devices.map((device) =>
      device.id === deviceId
        ? (() => {
            const host = update.host ? normalizeSavedDeviceHostInput(update.host) : device.host;
            const hostChanged = host !== device.host;
            clearSummary = hostChanged && Boolean(envelope.summaries[deviceId]);
            const nextName = resolveSavedDeviceStoredName(
              update.name === undefined ? device.name : update.name,
              host,
              update.nameSource ?? device.nameSource,
            );
            const nextType = resolveSavedDeviceStoredType(
              update.type === undefined ? device.type : update.type,
              update.lastKnownProduct ?? device.lastKnownProduct ?? null,
              update.typeSource ?? device.typeSource,
            );
            return {
              ...device,
              ...update,
              host,
              name: nextName.name,
              nameSource: nextName.nameSource,
              type: nextType.typeSource === "USER" ? nextType.type : hostChanged ? "" : nextType.type,
              typeSource: nextType.typeSource,
              lastKnownProduct:
                nextType.typeSource === "USER"
                  ? (update.lastKnownProduct ?? device.lastKnownProduct)
                  : hostChanged
                    ? null
                    : (update.lastKnownProduct ?? device.lastKnownProduct),
              lastKnownHostname:
                hostChanged && nextType.typeSource !== "USER"
                  ? null
                  : (update.lastKnownHostname ?? device.lastKnownHostname),
              lastKnownUniqueId:
                hostChanged && nextType.typeSource !== "USER"
                  ? null
                  : (update.lastKnownUniqueId ?? device.lastKnownUniqueId),
            };
          })()
        : device,
    );

    return {
      ...envelope,
      devices: nextDevices,
      summaries: clearSummary
        ? {
            ...envelope.summaries,
            [deviceId]: resetSavedDeviceSummaryVerification(envelope.summaries[deviceId]!),
          }
        : envelope.summaries,
    };
  });
};

export const updateSelectedSavedDeviceConnection = (update: {
  deviceHost: string;
  passwordPresent: boolean;
  httpPort?: number;
}) => {
  return updateSnapshot((envelope) => {
    let clearSummary = false;
    const selectedDeviceId = envelope.selectedDeviceId;
    const nextDevices = envelope.devices.map((device) =>
      device.id === selectedDeviceId
        ? (() => {
            const nextHost = stripSavedDeviceHttpPort(update.deviceHost);
            const hostChanged = nextHost !== device.host;
            clearSummary = hostChanged && Boolean(envelope.summaries[selectedDeviceId]);
            const nextName = resolveSavedDeviceStoredName(device.name, nextHost, device.nameSource);
            return {
              ...device,
              host: nextHost,
              name: nextName.name,
              nameSource: nextName.nameSource,
              type: device.typeSource === "USER" ? device.type : hostChanged ? "" : device.type,
              lastKnownProduct:
                device.typeSource === "USER" ? device.lastKnownProduct : hostChanged ? null : device.lastKnownProduct,
              lastKnownHostname:
                device.typeSource === "USER" ? device.lastKnownHostname : hostChanged ? null : device.lastKnownHostname,
              lastKnownUniqueId:
                device.typeSource === "USER" ? device.lastKnownUniqueId : hostChanged ? null : device.lastKnownUniqueId,
              httpPort: update.httpPort ?? splitSavedDeviceHostAndHttpPort(update.deviceHost).httpPort,
              hasPassword: update.passwordPresent,
            };
          })()
        : device,
    );

    return {
      ...envelope,
      devices: nextDevices,
      summaries: clearSummary
        ? {
            ...envelope.summaries,
            [selectedDeviceId]: resetSavedDeviceSummaryVerification(envelope.summaries[selectedDeviceId]!),
          }
        : envelope.summaries,
    };
  });
};

export const updateSelectedSavedDevicePorts = (update: { ftpPort?: number; telnetPort?: number }) => {
  return updateSnapshot((envelope) => ({
    ...envelope,
    devices: envelope.devices.map((device) =>
      device.id === envelope.selectedDeviceId
        ? {
            ...device,
            ftpPort: update.ftpPort ?? device.ftpPort,
            telnetPort: update.telnetPort ?? device.telnetPort,
          }
        : device,
    ),
  }));
};

export const selectSavedDevice = (deviceId: string) => {
  const nowIso = new Date().toISOString();
  const nextSnapshot = updateSnapshot((envelope) => {
    if (!envelope.devices.some((device) => device.id === deviceId)) {
      throw new Error(`Unknown saved device: ${deviceId}`);
    }
    return {
      ...envelope,
      selectedDeviceId: deviceId,
      devices: envelope.devices.map((device) =>
        device.id === deviceId
          ? {
              ...device,
              lastUsedAt: nowIso,
            }
          : device,
      ),
    };
  });
  broadcastSafetyConfigUpdate("selectedDeviceId", deviceId);
  return nextSnapshot;
};

export const removeSavedDevice = (deviceId: string) => {
  return updateSnapshot((envelope) => {
    const remaining = envelope.devices.filter((device) => device.id !== deviceId);
    if (!remaining.length) {
      throw new Error("At least one saved device is required.");
    }
    const nextSelectedDeviceId = envelope.selectedDeviceId === deviceId ? remaining[0].id : envelope.selectedDeviceId;
    const nextSummaries = { ...envelope.summaries };
    delete nextSummaries[deviceId];
    return {
      ...envelope,
      selectedDeviceId: nextSelectedDeviceId,
      devices: remaining,
      summaries: nextSummaries,
      summaryLru: envelope.summaryLru.filter((entry) => entry !== deviceId),
    };
  });
};

export const startSavedDeviceVerification = (deviceId: string) => {
  updateRuntime((current) => ({
    ...current,
    runtimeStatuses: {
      ...current.runtimeStatuses,
      [deviceId]: "verifying",
    },
  }));
  return updateSnapshot((envelope) => {
    const summary =
      envelope.summaries[deviceId] ??
      ({
        deviceId,
        verifiedAt: null,
        lastHealthState: null,
        lastConnectivityState: null,
        lastProbeSucceededAt: null,
        lastProbeFailedAt: null,
        lastVerifiedProduct: null,
        lastVerifiedHostname: null,
        lastVerifiedUniqueId: null,
        lastResolvedAddress: null,
      } satisfies DeviceSwitchSummary);
    const nextEnvelope: PersistedSavedDevicesEnvelope = {
      ...envelope,
      summaries: {
        ...envelope.summaries,
        [deviceId]: summary,
      },
    };
    touchSummaryLru(nextEnvelope, deviceId);
    return nextEnvelope;
  });
};

export const completeSavedDeviceVerification = (
  deviceId: string,
  verified: { product?: string | null; hostname?: string | null; unique_id?: string | null },
  resolvedAddress?: string | null,
) => {
  const product = resolveCanonicalProductFamilyCode(verified.product ?? null);
  const verifiedIdentity: VerifiedSavedDeviceIdentity = {
    product,
    hostname: verified.hostname?.trim() || null,
    uniqueId: verified.unique_id?.trim() || null,
  };
  const nowIso = new Date().toISOString();
  const nextSnapshot = updateSnapshot((envelope) => {
    const device = envelope.devices.find((entry) => entry.id === deviceId);
    if (!device) return envelope;
    const mismatch = resolveMismatch(device, verifiedIdentity);
    const updatedDevice: SavedDevice = {
      ...device,
      type: device.typeSource === "USER" ? device.type : (product ?? ""),
      typeSource: resolveSavedDeviceTypeSource(
        device.typeSource === "USER" ? (device.type ?? "") : (product ?? ""),
        product,
        device.typeSource,
      ),
      lastKnownProduct: product,
      lastKnownHostname: verifiedIdentity.hostname,
      lastKnownUniqueId: verifiedIdentity.uniqueId,
      lastSuccessfulConnectionAt: nowIso,
    };
    const nextEnvelope: PersistedSavedDevicesEnvelope = {
      ...envelope,
      devices: envelope.devices.map((entry) => (entry.id === deviceId ? updatedDevice : entry)),
      summaries: {
        ...envelope.summaries,
        [deviceId]: {
          deviceId,
          verifiedAt: nowIso,
          lastHealthState: mismatch ? "Mismatch" : "Healthy",
          lastConnectivityState: mismatch ? "Mismatch" : "Online",
          lastProbeSucceededAt: nowIso,
          lastProbeFailedAt: envelope.summaries[deviceId]?.lastProbeFailedAt ?? null,
          lastVerifiedProduct: product,
          lastVerifiedHostname: verifiedIdentity.hostname,
          lastVerifiedUniqueId: verifiedIdentity.uniqueId,
          lastResolvedAddress: resolvedAddress?.trim() || envelope.summaries[deviceId]?.lastResolvedAddress || null,
        },
      },
    };
    touchSummaryLru(nextEnvelope, deviceId);
    return nextEnvelope;
  });
  const actualDeviceId = (() => {
    if (!verifiedIdentity.uniqueId) return null;
    return (
      nextSnapshot.devices.find(
        (device) =>
          device.id !== deviceId && device.lastKnownUniqueId && device.lastKnownUniqueId === verifiedIdentity.uniqueId,
      )?.id ?? null
    );
  })();
  const device = nextSnapshot.devices.find((entry) => entry.id === deviceId) ?? null;
  const mismatch = device ? resolveMismatch(device, verifiedIdentity) : false;
  updateRuntime((current) => ({
    ...current,
    runtimeStatuses: {
      ...current.runtimeStatuses,
      [deviceId]: mismatch ? "mismatch" : "connected",
    },
    verifiedByDeviceId: {
      ...current.verifiedByDeviceId,
      [deviceId]: verifiedIdentity,
    },
    actualDeviceIdByDeviceId: {
      ...current.actualDeviceIdByDeviceId,
      [deviceId]: actualDeviceId,
    },
  }));
  broadcastSafetyConfigUpdate("verifiedProduct", {
    deviceId,
    product,
  });
  return getSavedDevicesSnapshot();
};

export const failSavedDeviceVerification = (deviceId: string) => {
  const nowIso = new Date().toISOString();
  updateRuntime((current) => ({
    ...current,
    runtimeStatuses: {
      ...current.runtimeStatuses,
      [deviceId]: "offline",
    },
    actualDeviceIdByDeviceId: {
      ...current.actualDeviceIdByDeviceId,
      [deviceId]: null,
    },
  }));
  return updateSnapshot((envelope) => {
    const nextEnvelope: PersistedSavedDevicesEnvelope = {
      ...envelope,
      summaries: {
        ...envelope.summaries,
        [deviceId]: {
          deviceId,
          verifiedAt: envelope.summaries[deviceId]?.verifiedAt ?? null,
          lastHealthState: "Unavailable",
          lastConnectivityState: "Offline",
          lastProbeSucceededAt: envelope.summaries[deviceId]?.lastProbeSucceededAt ?? null,
          lastProbeFailedAt: nowIso,
          lastVerifiedProduct: envelope.summaries[deviceId]?.lastVerifiedProduct ?? null,
          lastVerifiedHostname: envelope.summaries[deviceId]?.lastVerifiedHostname ?? null,
          lastVerifiedUniqueId: envelope.summaries[deviceId]?.lastVerifiedUniqueId ?? null,
          lastResolvedAddress: envelope.summaries[deviceId]?.lastResolvedAddress ?? null,
        },
      },
    };
    touchSummaryLru(nextEnvelope, deviceId);
    return nextEnvelope;
  });
};

export const getSelectedSavedDeviceBadgeLabel = () => {
  const current = getSavedDevicesSnapshot();
  const selectedDevice = current.devices.find((device) => device.id === current.selectedDeviceId);
  if (!selectedDevice) return "C64U";
  return buildSavedDevicePrimaryLabel(selectedDevice);
};

export const getSavedDeviceSwitchSummary = (deviceId: string): DeviceSwitchSummary | null => {
  return getSavedDevicesSnapshot().summaries[deviceId] ?? null;
};

export const getSavedDeviceSwitchStatus = (deviceId: string): DeviceSwitchStatus => {
  const current = getSavedDevicesSnapshot();
  const runtimeStatus = current.runtimeStatuses[deviceId];
  if (runtimeStatus) return runtimeStatus;
  if (deviceId === current.selectedDeviceId) {
    const summary = current.summaries[deviceId];
    if (!summary) return "last-known";
    const successStamp = summaryStamp({ ...summary, lastProbeFailedAt: null });
    const failureStamp = summary.lastProbeFailedAt ?? "";
    if (failureStamp && failureStamp > successStamp) return "offline";
    if (summary.lastVerifiedUniqueId || summary.lastVerifiedHostname || summary.lastVerifiedProduct)
      return "last-known";
  }
  return "last-known";
};

export const getSelectedSavedDeviceConnection = () => {
  const selectedDevice = getSelectedSavedDevice();
  if (!selectedDevice) {
    return {
      deviceHost: DEFAULT_DEVICE_HOST,
      host: DEFAULT_DEVICE_HOST,
      httpPort: DEFAULT_HTTP_PORT,
      ftpPort: DEFAULT_FTP_PORT,
      telnetPort: DEFAULT_TELNET_PORT,
      hasPassword: false,
    };
  }
  return {
    deviceHost: buildDeviceHost(selectedDevice.host, selectedDevice.httpPort),
    host: selectedDevice.host,
    httpPort: selectedDevice.httpPort,
    ftpPort: selectedDevice.ftpPort,
    telnetPort: selectedDevice.telnetPort,
    hasPassword: selectedDevice.hasPassword,
  };
};

export const setSavedDevicePasswordFlag = (deviceId: string, hasPassword: boolean) => {
  return updateSnapshot((envelope) => ({
    ...envelope,
    devices: envelope.devices.map((device) => (device.id === deviceId ? { ...device, hasPassword } : device)),
  }));
};

export const buildSavedDeviceDiagnosticsAttribution = (
  device: SavedDevice | null | undefined,
  verified?: VerifiedSavedDeviceIdentity | null,
): DiagnosticsDeviceAttribution | null => {
  const attribution: DiagnosticsDeviceAttribution = {
    savedDeviceId: device?.id ?? null,
    savedDeviceNameSnapshot: device ? buildSavedDevicePrimaryLabel(device, verified ?? null) : null,
    savedDeviceHostSnapshot: device?.host ?? null,
    verifiedUniqueId: verified?.uniqueId ?? null,
    verifiedHostname: verified?.hostname ?? null,
    verifiedProduct: verified?.product ?? null,
  };
  return Object.values(attribution).some((value) => value !== null) ? attribution : null;
};

export const getSavedDevicesEventName = () => EVENT_NAME;
