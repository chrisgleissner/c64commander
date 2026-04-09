/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { inferConnectedDeviceLabel } from "@/lib/diagnostics/targetDisplayMapper";

export type ProductFamilyCode = "C64U" | "U64" | "U64E" | "U64E2";

export type SavedDevice = {
  id: string;
  nickname: string | null;
  shortLabel: string | null;
  host: string;
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
};

export type SavedDevicesSnapshot = {
  selectedDeviceId: string;
  devices: SavedDevice[];
  summaries: Record<string, DeviceSwitchSummary>;
  summaryLru: string[];
  runtimeStatuses: Record<string, DeviceSwitchStatus>;
  verifiedByDeviceId: Record<string, VerifiedSavedDeviceIdentity | null>;
  actualDeviceIdByDeviceId: Record<string, string | null>;
};

const STORAGE_KEY = "c64u_saved_devices:v1";
const EVENT_NAME = "c64u-saved-devices-change";
const LEGACY_DEVICE_HOST_KEY = "c64u_device_host";
const LEGACY_BASE_URL_KEY = "c64u_base_url";
const LEGACY_FTP_PORT_KEY = "c64u_ftp_port";
const LEGACY_TELNET_PORT_KEY = "c64u_telnet_port";
const LEGACY_HAS_PASSWORD_KEY = "c64u_has_password";
const DEFAULT_DEVICE_HOST = "c64u";
const DEFAULT_HTTP_PORT = 80;
const DEFAULT_FTP_PORT = 21;
const DEFAULT_TELNET_PORT = 64;
const SUMMARY_NON_SELECTED_LIMIT = 3;

const listeners = new Set<() => void>();

let snapshot: SavedDevicesSnapshot | null = null;

const compact = (value: string) => value.replace(/[^a-z0-9]+/gi, "");

const normalizeHostInput = (input?: string | null) => {
  const raw = input?.trim() ?? "";
  if (!raw) return DEFAULT_DEVICE_HOST;
  if (/^[a-z]+:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return (url.host || url.hostname || DEFAULT_DEVICE_HOST).trim() || DEFAULT_DEVICE_HOST;
    } catch {
      return DEFAULT_DEVICE_HOST;
    }
  }
  return raw.split("/")[0]?.trim() || DEFAULT_DEVICE_HOST;
};

const parsePort = (value: string | null | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
  return parsed;
};

const splitHostAndHttpPort = (deviceHost?: string | null) => {
  const normalized = normalizeHostInput(deviceHost);

  if (normalized.startsWith("[")) {
    const closeBracketIndex = normalized.indexOf("]");
    if (closeBracketIndex !== -1) {
      const host = normalized.slice(0, closeBracketIndex + 1);
      const rest = normalized.slice(closeBracketIndex + 1);
      if (rest.startsWith(":")) {
        const httpPort = parsePort(rest.slice(1), DEFAULT_HTTP_PORT);
        return { host, httpPort };
      }
      return { host, httpPort: DEFAULT_HTTP_PORT };
    }
  }

  const colonCount = (normalized.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const separatorIndex = normalized.lastIndexOf(":");
    const maybePort = normalized.slice(separatorIndex + 1);
    if (/^\d+$/.test(maybePort)) {
      return {
        host: normalized.slice(0, separatorIndex) || DEFAULT_DEVICE_HOST,
        httpPort: parsePort(maybePort, DEFAULT_HTTP_PORT),
      };
    }
  }

  return { host: normalized, httpPort: DEFAULT_HTTP_PORT };
};

const stripHostPort = (deviceHost?: string | null) => splitHostAndHttpPort(deviceHost).host;

const buildDeviceHost = (host: string, httpPort: number) => {
  const normalizedHost = normalizeHostInput(host);
  if (httpPort === DEFAULT_HTTP_PORT) return normalizedHost;
  const bracketed =
    normalizedHost.includes(":") && !normalizedHost.startsWith("[") ? `[${normalizedHost}]` : normalizedHost;
  return `${bracketed}:${httpPort}`;
};

const createId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto && crypto.randomUUID()) ||
  `${Date.now().toString(36)}-${Math.round(Math.random() * 1e9).toString(36)}`;

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
        nickname: device.nickname ?? null,
        shortLabel: device.shortLabel ?? null,
        host: normalizeHostInput(device.host),
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
                } satisfies DeviceSwitchSummary,
              ]),
            )
          : {},
      summaryLru: Array.isArray(parsed.summaryLru)
        ? parsed.summaryLru.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return null;
  }
};

const createLegacyDevice = (): SavedDevice => {
  const storedHost = typeof localStorage === "undefined" ? null : localStorage.getItem(LEGACY_DEVICE_HOST_KEY);
  const legacyBaseUrl = typeof localStorage === "undefined" ? null : localStorage.getItem(LEGACY_BASE_URL_KEY);
  const resolvedHost = storedHost || legacyBaseUrl || DEFAULT_DEVICE_HOST;
  const { host, httpPort } = splitHostAndHttpPort(resolvedHost);
  return {
    id: createId(),
    nickname: null,
    shortLabel: null,
    host,
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

const createInitialEnvelope = (): PersistedSavedDevicesEnvelope => {
  const device = createLegacyDevice();
  return {
    version: 1,
    selectedDeviceId: device.id,
    devices: [device],
    summaries: {},
    summaryLru: [],
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
  };
};

const selectedDeviceFromEnvelope = (envelope: PersistedSavedDevicesEnvelope) =>
  envelope.devices.find((device) => device.id === envelope.selectedDeviceId) ?? envelope.devices[0] ?? null;

const buildSnapshot = (envelope: PersistedSavedDevicesEnvelope): SavedDevicesSnapshot => ({
  selectedDeviceId: envelope.selectedDeviceId,
  devices: envelope.devices,
  summaries: envelope.summaries,
  summaryLru: envelope.summaryLru,
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

const summaryStamp = (summary: DeviceSwitchSummary): string =>
  summary.lastProbeSucceededAt ?? summary.lastProbeFailedAt ?? summary.verifiedAt ?? "";

const compactLabelToken = (value: string) => {
  const token = value
    .trim()
    .split(/\s+/)
    .find((part) => compact(part).length > 0);
  if (!token) return null;
  const normalized = token.replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 8);
  return normalized || null;
};

const deriveShortLabelFromHost = (host: string) => {
  const base = stripHostPort(host).replace(/^\[|\]$/g, "");
  const ipv4Match = /^(?:\d{1,3}\.){3}(\d{1,3})$/.exec(base);
  if (ipv4Match) return ipv4Match[1]?.slice(0, 8) ?? null;
  const ipv6Parts = base.split(":").filter(Boolean);
  if (ipv6Parts.length > 1) {
    return ipv6Parts[ipv6Parts.length - 1]?.slice(0, 8) ?? null;
  }
  return compactLabelToken(base.split(".")[0] ?? base);
};

const isUniqueShortLabel = (devices: SavedDevice[], deviceId: string, candidate: string) => {
  const normalizedCandidate = candidate.trim().toLowerCase();
  return !devices.some(
    (device) =>
      device.id !== deviceId && device.shortLabel && device.shortLabel.trim().toLowerCase() === normalizedCandidate,
  );
};

export const resolveCanonicalProductFamilyCode = (product?: string | null): ProductFamilyCode | null => {
  return inferConnectedDeviceLabel(product ?? null) ?? null;
};

export const buildSavedDevicePrimaryLabel = (device: SavedDevice, verified?: VerifiedSavedDeviceIdentity | null) => {
  return device.nickname?.trim() || verified?.hostname?.trim() || device.lastKnownHostname?.trim() || device.host;
};

export const deriveSavedDeviceShortLabel = (device: SavedDevice, devices: SavedDevice[]) => {
  if (device.shortLabel?.trim()) return device.shortLabel.trim().slice(0, 8);
  const nicknameToken = device.nickname ? compactLabelToken(device.nickname) : null;
  if (nicknameToken && isUniqueShortLabel(devices, device.id, nicknameToken)) return nicknameToken;
  const hostnameToken = device.lastKnownHostname
    ? compactLabelToken(device.lastKnownHostname)
    : compactLabelToken(device.host);
  if (hostnameToken && isUniqueShortLabel(devices, device.id, hostnameToken)) return hostnameToken;
  const hostToken = deriveShortLabelFromHost(device.host);
  if (hostToken && isUniqueShortLabel(devices, device.id, hostToken)) return hostToken;
  return device.lastKnownProduct ?? "C64U";
};

export const validateSavedDeviceShortLabel = (devices: SavedDevice[], deviceId: string, shortLabel: string) => {
  const trimmed = shortLabel.trim();
  if (!trimmed) return "Short label is required.";
  if (trimmed.length > 8) return "Short label must be 8 characters or fewer.";
  if (!isUniqueShortLabel(devices, deviceId, trimmed)) return "Short label must be unique.";
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
  return { kind: "configured-host" as const, host: device.host.toLowerCase() };
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
  if (verified.hostname) {
    return verified.hostname.toLowerCase() !== expected.host;
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

export const getSavedDeviceById = (deviceId: string) => {
  const current = getSavedDevicesSnapshot();
  return current.devices.find((device) => device.id === deviceId) ?? null;
};

export const addSavedDevice = (
  draft: Omit<SavedDevice, "id" | "lastSuccessfulConnectionAt" | "lastUsedAt"> & { id?: string },
) => {
  return updateSnapshot((envelope) => {
    const nextDevice: SavedDevice = {
      id: draft.id ?? createId(),
      nickname: draft.nickname ?? null,
      shortLabel: draft.shortLabel ?? null,
      host: normalizeHostInput(draft.host),
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
    };
  });
};

export const updateSavedDevice = (deviceId: string, update: Partial<Omit<SavedDevice, "id">>) => {
  return updateSnapshot((envelope) => ({
    ...envelope,
    devices: envelope.devices.map((device) =>
      device.id === deviceId
        ? {
            ...device,
            ...update,
            host: update.host ? normalizeHostInput(update.host) : device.host,
            shortLabel: update.shortLabel === undefined ? device.shortLabel : update.shortLabel,
            nickname: update.nickname === undefined ? device.nickname : update.nickname,
          }
        : device,
    ),
  }));
};

export const updateSelectedSavedDeviceConnection = (update: {
  deviceHost: string;
  passwordPresent: boolean;
  httpPort?: number;
}) => {
  return updateSnapshot((envelope) => ({
    ...envelope,
    devices: envelope.devices.map((device) =>
      device.id === envelope.selectedDeviceId
        ? {
            ...device,
            host: stripHostPort(update.deviceHost),
            httpPort: update.httpPort ?? splitHostAndHttpPort(update.deviceHost).httpPort,
            hasPassword: update.passwordPresent,
          }
        : device,
    ),
  }));
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
  return updateSnapshot((envelope) => {
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
  return deriveSavedDeviceShortLabel(selectedDevice, current.devices);
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

export const getSavedDevicesEventName = () => EVENT_NAME;
