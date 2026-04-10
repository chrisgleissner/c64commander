import type { SavedDevice } from "@/lib/savedDevices/store";

export type SavedDeviceEditorDraft = {
  name: string;
  host: string;
  httpPort: string;
  ftpPort: string;
  telnetPort: string;
};

export const sanitizeSavedDevicePortInput = (value: string) => value.replace(/[^0-9]/g, "");

export const buildSavedDeviceEditorDraft = (
  device: Pick<SavedDevice, "name" | "host" | "httpPort" | "ftpPort" | "telnetPort"> | null | undefined,
  fallbackHost = "c64u",
): SavedDeviceEditorDraft => ({
  name: device?.name ?? "",
  host: device?.host ?? fallbackHost,
  httpPort: String(device?.httpPort ?? 80),
  ftpPort: String(device?.ftpPort ?? 21),
  telnetPort: String(device?.telnetPort ?? 64),
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
