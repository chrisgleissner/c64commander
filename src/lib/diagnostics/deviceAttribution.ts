import {
  buildSavedDevicePrimaryLabel,
  type ProductFamilyCode,
  type SavedDevicesSnapshot,
} from "@/lib/savedDevices/store";

export type DiagnosticsDeviceAttribution = {
  savedDeviceId: string | null;
  savedDeviceNameSnapshot: string | null;
  savedDeviceHostSnapshot: string | null;
  verifiedUniqueId: string | null;
  verifiedHostname: string | null;
  verifiedProduct: ProductFamilyCode | null;
};

export type DiagnosticsDeviceContext = DiagnosticsDeviceAttribution & {
  connectionState: string | null;
};

const trimString = (value: unknown) => (typeof value === "string" ? value.trim() || null : null);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const createEmptyDiagnosticsDeviceAttribution = (): DiagnosticsDeviceAttribution => ({
  savedDeviceId: null,
  savedDeviceNameSnapshot: null,
  savedDeviceHostSnapshot: null,
  verifiedUniqueId: null,
  verifiedHostname: null,
  verifiedProduct: null,
});

export const cloneDiagnosticsDeviceAttribution = (
  value: DiagnosticsDeviceAttribution | null | undefined,
): DiagnosticsDeviceAttribution | null => {
  if (!value) return null;
  return {
    savedDeviceId: value.savedDeviceId ?? null,
    savedDeviceNameSnapshot: value.savedDeviceNameSnapshot ?? null,
    savedDeviceHostSnapshot: value.savedDeviceHostSnapshot ?? null,
    verifiedUniqueId: value.verifiedUniqueId ?? null,
    verifiedHostname: value.verifiedHostname ?? null,
    verifiedProduct: value.verifiedProduct ?? null,
  };
};

export const cloneDiagnosticsDeviceContext = (
  value: DiagnosticsDeviceContext | null | undefined,
): DiagnosticsDeviceContext | null => {
  if (!value) return null;
  const attribution = cloneDiagnosticsDeviceAttribution(value);
  if (!attribution) return null;
  return {
    ...attribution,
    connectionState: value.connectionState ?? null,
  };
};

export const toDiagnosticsDeviceAttribution = (
  value: DiagnosticsDeviceAttribution | DiagnosticsDeviceContext | null | undefined,
): DiagnosticsDeviceAttribution | null => cloneDiagnosticsDeviceAttribution(value ?? null);

export const readDiagnosticsDeviceAttribution = (value: unknown): DiagnosticsDeviceAttribution | null => {
  if (!isRecord(value)) return null;
  const attribution: DiagnosticsDeviceAttribution = {
    savedDeviceId: trimString(value.savedDeviceId),
    savedDeviceNameSnapshot: trimString(value.savedDeviceNameSnapshot),
    savedDeviceHostSnapshot: trimString(value.savedDeviceHostSnapshot),
    verifiedUniqueId: trimString(value.verifiedUniqueId),
    verifiedHostname: trimString(value.verifiedHostname),
    verifiedProduct:
      value.verifiedProduct === "C64U" ||
      value.verifiedProduct === "U64" ||
      value.verifiedProduct === "U64E" ||
      value.verifiedProduct === "U64E2"
        ? value.verifiedProduct
        : null,
  };
  return Object.values(attribution).some((entry) => entry !== null) ? attribution : null;
};

export const readDiagnosticsDeviceContext = (value: unknown): DiagnosticsDeviceContext | null => {
  const attribution = readDiagnosticsDeviceAttribution(value);
  if (!attribution) return null;
  return {
    ...attribution,
    connectionState: isRecord(value) ? trimString(value.connectionState) : null,
  };
};

export const hasDiagnosticsDeviceAttribution = (value: DiagnosticsDeviceAttribution | null | undefined) =>
  Boolean(value && (value.savedDeviceId || value.savedDeviceNameSnapshot || value.verifiedUniqueId));

export const shouldShowDiagnosticsDeviceUi = (
  savedDevices: Pick<SavedDevicesSnapshot, "devices" | "hasEverHadMultipleDevices">,
) => savedDevices.devices.length > 1 || savedDevices.hasEverHadMultipleDevices;

export const resolveDiagnosticsDeviceLabel = (
  attribution: DiagnosticsDeviceAttribution | null | undefined,
  savedDevices: SavedDevicesSnapshot,
): string | null => {
  if (!attribution) return null;
  if (attribution.savedDeviceId) {
    const device = savedDevices.devices.find((entry) => entry.id === attribution.savedDeviceId);
    if (device) {
      return buildSavedDevicePrimaryLabel(device, savedDevices.verifiedByDeviceId[device.id] ?? null);
    }
  }
  return attribution.savedDeviceNameSnapshot?.trim() || null;
};

export const formatDiagnosticsVerifiedDeviceLabel = (
  attribution: DiagnosticsDeviceAttribution | null | undefined,
): string | null => {
  if (!attribution) return null;
  const parts = [attribution.verifiedProduct, attribution.verifiedHostname, attribution.verifiedUniqueId].filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
};
