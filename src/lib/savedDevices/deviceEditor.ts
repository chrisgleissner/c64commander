import type { SavedDevice, SavedDeviceFieldSource } from "@/lib/savedDevices/store";

export const MAX_SAVED_DEVICE_NAME_LENGTH = 10;

export type SavedDeviceEditorDraft = {
  name: string;
  nameSource: SavedDeviceFieldSource;
  host: string;
  type: string;
  typeSource: SavedDeviceFieldSource;
  httpPort: string;
  ftpPort: string;
  telnetPort: string;
};

export const sanitizeSavedDeviceNameInput = (value: string) => value.trim().slice(0, MAX_SAVED_DEVICE_NAME_LENGTH);

export const sanitizeSavedDevicePortInput = (value: string) => value.replace(/[^0-9]/g, "");

const normalizeDraftSource = (source: SavedDevice["nameSource"] | SavedDevice["typeSource"] | undefined) =>
  source === "USER" || source === "custom" ? "USER" : "INFERRED";

const inferDraftNameFromHost = (host: string) => host.trim();

export const buildSavedDeviceEditorDraft = (
  device:
    | Pick<SavedDevice, "name" | "nameSource" | "host" | "type" | "typeSource" | "httpPort" | "ftpPort" | "telnetPort">
    | null
    | undefined,
  fallbackHost = "c64u",
): SavedDeviceEditorDraft => {
  const host = device?.host ?? fallbackHost;
  const nameSource = normalizeDraftSource(device?.nameSource);
  const typeSource = normalizeDraftSource(device?.typeSource);

  return {
    name: nameSource === "USER" ? sanitizeSavedDeviceNameInput(device?.name ?? "") : inferDraftNameFromHost(host),
    nameSource,
    host,
    type: typeSource === "USER" ? (device?.type?.trim() ?? "") : (device?.type?.trim() ?? ""),
    typeSource,
    httpPort: String(device?.httpPort ?? 80),
    ftpPort: String(device?.ftpPort ?? 21),
    telnetPort: String(device?.telnetPort ?? 64),
  };
};

export const applySavedDeviceDraftNameInput = (
  draft: SavedDeviceEditorDraft,
  value: string,
): SavedDeviceEditorDraft => {
  const name = sanitizeSavedDeviceNameInput(value);
  if (!name) {
    return {
      ...draft,
      name: inferDraftNameFromHost(draft.host),
      nameSource: "INFERRED",
    };
  }

  return {
    ...draft,
    name,
    nameSource: "USER",
  };
};

export const applySavedDeviceDraftHostInput = (
  draft: SavedDeviceEditorDraft,
  value: string,
): SavedDeviceEditorDraft => ({
  ...draft,
  host: value,
  name: draft.nameSource === "INFERRED" ? inferDraftNameFromHost(value) : draft.name,
  type: draft.typeSource === "INFERRED" ? "" : draft.type,
});

const isValidPort = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535;
};

export const validateSavedDevicePorts = (draft: SavedDeviceEditorDraft) => {
  if (!isValidPort(draft.httpPort)) return "HTTP port must be 1 to 65535.";
  if (!isValidPort(draft.ftpPort)) return "FTP port must be 1 to 65535.";
  if (!isValidPort(draft.telnetPort)) return "Telnet port must be 1 to 65535.";
  return null;
};
