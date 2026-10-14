/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import { SavedDeviceEditorFields } from "@/components/devices/SavedDeviceEditorFields";
import { Button } from "@/components/ui/button";
import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
} from "@/components/ui/app-surface";
import { evaluateNewDeviceReachability } from "@/lib/connection/addDeviceReachability";
import { buildDeviceHostWithHttpPort, stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import {
  buildSavedDeviceEditorDraft,
  type SavedDeviceEditorDraft,
  validateSavedDevicePorts,
} from "@/lib/savedDevices/deviceEditor";
import { normalizeSavedDeviceHostInput } from "@/lib/savedDevices/host";
import {
  addSavedDevice,
  buildSavedDevicePrimaryLabel,
  type SavedDevice,
  validateSavedDeviceName,
} from "@/lib/savedDevices/store";
import { getStoredTelnetPort } from "@/lib/telnet/telnetConfig";
import { reportUserError } from "@/lib/uiErrors";
import { validateDeviceHost } from "@/lib/validation/connectionValidation";

const createDeviceId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto && crypto.randomUUID()) ||
  `${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`;

const buildEmptyDraft = (): SavedDeviceEditorDraft =>
  buildSavedDeviceEditorDraft(
    {
      name: "",
      host: "",
      type: "",
      httpPort: 80,
      ftpPort: getStoredFtpPort(),
      telnetPort: getStoredTelnetPort(),
    },
    "",
  );

export const findSavedDeviceWithSameAddress = (devices: SavedDevice[], host: string, httpPort: number) => {
  const hostKey = normalizeSavedDeviceHostInput(host).toLowerCase();
  return devices.find((device) => device.host.trim().toLowerCase() === hostKey && device.httpPort === httpPort) ?? null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: SavedDevice[];
  keypadInput: boolean;
  onAdded: (deviceId: string) => Promise<void>;
};

export function AddSavedDeviceDialog({ open, onOpenChange, devices, keypadInput, onAdded }: Props) {
  const [deviceId, setDeviceId] = useState(createDeviceId);
  const [draft, setDraft] = useState(buildEmptyDraft);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [portError, setPortError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ address: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDeviceId(createDeviceId());
    setDraft(buildEmptyDraft());
    setNameError(null);
    setHostError(null);
    setPortError(null);
    setSuggestion(null);
  }, [open]);

  const handleDraftChange = (next: SavedDeviceEditorDraft) => {
    setDraft(next);
    setSuggestion(null);
    setHostError(null);
    setNameError(null);
    setPortError(null);
  };

  const validateDraft = (host: string, httpPort: number) => {
    const sameAddress = host ? findSavedDeviceWithSameAddress(devices, host, httpPort) : null;
    const nextHostError = !host
      ? "Enter a host or IP address."
      : (validateDeviceHost(host) ??
        (sameAddress ? `Already saved as ${buildSavedDevicePrimaryLabel(sameAddress)}.` : null));
    const nextNameError = validateSavedDeviceName(devices, deviceId, draft.name, host);
    const nextPortError = validateSavedDevicePorts(draft);
    setHostError(nextHostError);
    setNameError(nextNameError);
    setPortError(nextPortError);
    return !nextHostError && !nextNameError && !nextPortError;
  };

  const handleAdd = async () => {
    if (busy) return;
    const typedHost = draft.host.trim();
    const host = typedHost ? stripPortFromDeviceHost(typedHost) : "";
    const httpPort = Number(draft.httpPort);
    if (!validateDraft(host, httpPort)) return;
    setBusy(true);
    try {
      const reachability = await evaluateNewDeviceReachability({
        host,
        deviceHost: buildDeviceHostWithHttpPort(host, httpPort),
      });
      if (reachability.status === "unreachable") {
        setSuggestion(reachability.suggestedAddress ? { address: reachability.suggestedAddress } : null);
        setHostError(
          reachability.suggestedAddress
            ? null
            : `We couldn’t reach “${host}”. Make sure it’s powered on and on the same Wi‑Fi.`,
        );
        return;
      }
      addSavedDevice({
        id: deviceId,
        name: draft.name,
        nameSource: draft.nameSource,
        host,
        httpPort,
        ftpPort: Number(draft.ftpPort),
        telnetPort: Number(draft.telnetPort),
        lastKnownProduct: null,
        lastKnownHostname: null,
        lastKnownUniqueId: null,
        hasPassword: false,
      });
      onOpenChange(false);
      await onAdded(deviceId);
    } catch (error) {
      reportUserError({
        operation: "DEVICE_ADD",
        title: "Unable to add device",
        description: (error as Error).message,
        error,
        context: { host },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppDialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent data-testid="settings-add-device-dialog">
        <AppDialogHeader>
          <AppDialogTitle>Add device</AppDialogTitle>
          <AppDialogDescription>The app connects to it once it answers.</AppDialogDescription>
        </AppDialogHeader>
        <AppDialogBody>
          <SavedDeviceEditorFields
            draft={draft}
            onChange={handleDraftChange}
            nameError={nameError}
            hostError={hostError}
            portError={portError}
            idPrefix="add-device"
            hostLabel="C64U hostname / IP"
            reachabilitySuggestion={suggestion}
            onUseSuggestedAddress={(address) => handleDraftChange({ ...draft, host: address })}
            keypadInput={keypadInput}
          />
        </AppDialogBody>
        <AppDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="settings-add-device-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleAdd()}
            disabled={busy}
            data-testid="settings-add-device-confirm"
          >
            {busy ? "Checking…" : "Add"}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </AppDialog>
  );
}
