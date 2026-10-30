/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";
import { toast } from "@/hooks/use-toast";
import { addLog } from "@/lib/logging";
import { C64_DEFAULTS } from "@/lib/c64api";
import { buildDeviceHostWithHttpPort, stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { evaluateNewDeviceReachability } from "@/lib/connection/addDeviceReachability";
import { setStoredFtpPort } from "@/lib/ftp/ftpConfig";
import {
  buildSavedDeviceEditorDraft,
  isLocalOnlySavedDeviceEdit,
  validateSavedDevicePorts,
  type SavedDeviceEditorDraft,
} from "@/lib/savedDevices/deviceEditor";
import { isSupersededSavedDeviceSwitch } from "@/lib/savedDevices/savedDeviceSwitchOutcome";
import {
  getSavedDevicesSnapshot,
  updateSavedDevice,
  validateSavedDeviceName,
  type SavedDevice,
} from "@/lib/savedDevices/store";
import { clearPasswordForDevice, getPasswordForDevice, setPasswordForDevice } from "@/lib/secureStorage";
import { setStoredTelnetPort } from "@/lib/telnet/telnetConfig";
import { validateDeviceHost } from "@/lib/validation/connectionValidation";
import { describeUnreachableHost, type ConnectionSaveReporter } from "@/pages/settings/connectionSaveRefusal";

export const isOfflineSwitchResult = (
  value: unknown,
): value is { ok: false; error?: string | null; authRequired?: boolean } =>
  typeof value === "object" && value !== null && "ok" in value && (value as { ok?: unknown }).ok === false;

// The device answered but rejected the password (HTTP 401/403) — this is not the same
// failure as an unreachable device, and must not be reported as one (HARD9-028).
export const describeSwitchFailure = (
  verification: { error?: string | null; authRequired?: boolean },
  fallbackMessage: string,
): string =>
  verification.authRequired
    ? "The device rejected the password. Check the password and try again."
    : (verification.error ?? fallbackMessage);

const SAVE_TIMEOUT_MS = 30_000;

const pendingDeadlineTimers = new Set<ReturnType<typeof setTimeout>>();

/** One deadline for the whole save: a device or a secure store that never answers must not disable the page for good. */
const startSaveDeadline = () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Saving the connection took too long. Check the device and try again.")),
      SAVE_TIMEOUT_MS,
    );
  });
  expired.catch(() => undefined);
  if (timer !== undefined) pendingDeadlineTimers.add(timer);
  return {
    guard: <T>(work: Promise<T>): Promise<T> => Promise.race([work, expired]),
    stop: () => {
      clearTimeout(timer);
      if (timer !== undefined) pendingDeadlineTimers.delete(timer);
    },
  };
};

let saveInFlight = 0;
const saveListeners = new Set<() => void>();
const notifySaveListeners = () => saveListeners.forEach((listener) => listener());
const subscribeToSaves = (listener: () => void) => {
  saveListeners.add(listener);
  return () => saveListeners.delete(listener);
};

/** Forgets saves that a test left waiting. Never call in production code. */
export const __resetConnectionSaveStateForTests = (): void => {
  pendingDeadlineTimers.forEach((timer) => clearTimeout(timer));
  pendingDeadlineTimers.clear();
  saveInFlight = 0;
  notifySaveListeners();
};

/** True while a save waits for a device, whichever page instance started it. */
export const isConnectionSaveInFlight = (): boolean => saveInFlight > 0;
export const useConnectionSaveInFlight = (): boolean =>
  useSyncExternalStore(subscribeToSaves, isConnectionSaveInFlight, isConnectionSaveInFlight);

export type SaveConnectionContext = {
  device: SavedDevice;
  draft: SavedDeviceEditorDraft;
  passwordEditing: boolean;
  typedPassword: string;
  isConnected: boolean;
  editor: {
    setHostnameError: (message: string | null) => void;
    setDeviceNameError: (message: string | null) => void;
    setConnectionFieldError: (message: string | null) => void;
    setPasswordError: (message: string | null) => void;
    setReachabilitySuggestion: (suggestion: { address: string } | null) => void;
    finishSave: (hasPassword: boolean) => void;
  };
  report: ConnectionSaveReporter;
  updateConfig: (host: string, password?: string) => void;
  switchSavedDevice: (deviceId: string) => Promise<unknown>;
};

/**
 * Saves the edited connection settings of one saved device and connects to it. The saved devices are read
 * again after every wait, because the user can select, delete or add a device while the device is being asked:
 * nothing is written for a device that no longer exists, and a device that is no longer selected gets its
 * edits stored but neither the connection nor the editor.
 */
export const saveConnection = async (context: SaveConnectionContext): Promise<void> => {
  const { device, draft, editor, report } = context;
  const hostError = validateDeviceHost(draft.host);
  editor.setHostnameError(hostError);
  const nameError = validateSavedDeviceName(getSavedDevicesSnapshot().devices, device.id, draft.name, draft.host);
  editor.setDeviceNameError(nameError);
  const portError = validateSavedDevicePorts(draft);
  editor.setConnectionFieldError(portError);
  const validationError = nameError ?? hostError ?? portError;
  if (validationError) {
    report.invalid(validationError);
    return;
  }
  const nextHost = stripPortFromDeviceHost(draft.host.trim() || C64_DEFAULTS.DEFAULT_DEVICE_HOST);
  const nextDeviceHost = buildDeviceHostWithHttpPort(nextHost, Number(draft.httpPort));
  editor.setPasswordError(null);
  saveInFlight += 1;
  notifySaveListeners();
  const deadline = startSaveDeadline();
  try {
    // The field never displays the real saved secret (HARD9-004): while `passwordEditing`
    // is false the user hasn't touched it, so reuse the stored password unchanged instead
    // of the empty value that's actually sitting in the (never-shown) input.
    const isChangingPassword = context.passwordEditing;
    const effectivePassword = isChangingPassword
      ? context.typedPassword
      : device.hasPassword
        ? ((await deadline.guard(getPasswordForDevice(device.id))) ?? "")
        : "";
    const hasPassword = effectivePassword.length > 0;
    // HARD27-037: a rename or an FTP/Telnet port correction cannot make the device
    // unreachable, so it must not be gated on a probe that fails while the machine
    // is switched off.
    const savedDraft = buildSavedDeviceEditorDraft(device, device.host);
    // `passwordEditing` is true whenever the field is editable, which it is for every
    // device that has no stored password. Only a password that is actually being set
    // or cleared needs the device to answer.
    const isChangingStoredPassword = isChangingPassword && (hasPassword || device.hasPassword);
    const isLocalOnlyEdit = isLocalOnlySavedDeviceEdit(
      { host: device.host, httpPort: device.httpPort },
      { host: nextHost, httpPort: Number(draft.httpPort) },
      isChangingStoredPassword,
      draft.name !== savedDraft.name ||
        draft.type !== savedDraft.type ||
        draft.ftpPort !== savedDraft.ftpPort ||
        draft.telnetPort !== savedDraft.telnetPort,
    );
    // Pre-commit reachability gate: never persist an unreachable device. When an
    // entered hostname can't be reached but the device is found on the LAN, calmly
    // steer the user to its IP address instead of failing silently.
    const reachability = isLocalOnlyEdit
      ? null
      : await deadline.guard(
          evaluateNewDeviceReachability({
            host: nextHost,
            deviceHost: nextDeviceHost,
            password: hasPassword ? effectivePassword : null,
          }),
        );
    let saved = getSavedDevicesSnapshot();
    if (!saved.devices.some((entry) => entry.id === device.id)) {
      report.dismiss();
      return;
    }
    let isStillSelected = saved.selectedDeviceId === device.id;
    if (reachability?.status === "unreachable") {
      const { suggestedAddress } = reachability;
      const unreachableMessage = describeUnreachableHost(nextHost, suggestedAddress);
      if (isStillSelected) {
        editor.setReachabilitySuggestion(suggestedAddress ? { address: suggestedAddress } : null);
        editor.setHostnameError(suggestedAddress ? null : unreachableMessage);
      }
      report.refused(unreachableMessage, device.host);
      return;
    }
    if (reachability?.status === "needs-password" && isChangingPassword && hasPassword) {
      // The just-typed password was itself rejected by the device. A wrong password
      // must never be persisted (HARD9-004) — surface it as an auth failure, not a save.
      if (isStillSelected) editor.setPasswordError("Wrong password for this device.");
      report.refused("Wrong password for this device.", device.host);
      return;
    }
    if (isStillSelected) editor.setReachabilitySuggestion(null);
    if (isChangingPassword) {
      if (hasPassword) {
        await deadline.guard(setPasswordForDevice(device.id, effectivePassword));
      } else {
        await deadline.guard(clearPasswordForDevice(device.id));
      }
    }
    saved = getSavedDevicesSnapshot();
    if (!saved.devices.some((entry) => entry.id === device.id)) {
      if (isChangingPassword) {
        await clearPasswordForDevice(device.id).catch((error: unknown) =>
          addLog("warn", "Could not remove the password stored for a device that was deleted during the save", {
            deviceId: device.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      report.dismiss();
      return;
    }
    isStillSelected = saved.selectedDeviceId === device.id;
    if (isStillSelected) {
      setStoredFtpPort(Number(draft.ftpPort));
      setStoredTelnetPort(Number(draft.telnetPort));
    }
    updateSavedDevice(device.id, {
      name: draft.name,
      nameSource: draft.nameSource,
      host: nextHost,
      httpPort: Number(draft.httpPort),
      ftpPort: Number(draft.ftpPort),
      telnetPort: Number(draft.telnetPort),
      hasPassword,
    });
    if (!isStillSelected) {
      report.dismiss();
      toast({ title: "Connection settings saved" });
      return;
    }
    context.updateConfig(nextDeviceHost, hasPassword ? effectivePassword : undefined);
    // A local-only edit still re-applies to a live connection, but a device that is
    // not connected is not made to answer: that wait and its failure are exactly what
    // HARD27-037 removed.
    if (!isLocalOnlyEdit || context.isConnected) {
      const verification = await deadline.guard(context.switchSavedDevice(device.id));
      if (isSupersededSavedDeviceSwitch(verification)) {
        report.dismiss();
        return;
      }
      if (isOfflineSwitchResult(verification) && !isLocalOnlyEdit) {
        throw new Error(
          describeSwitchFailure(
            verification,
            `Unable to reach ${nextHost}. Check the hostname/IP address and confirm the device is powered on.`,
          ),
        );
      }
    }
    editor.finishSave(hasPassword);
    report.dismiss();
    toast({ title: "Connection settings saved" });
  } catch (error) {
    report.failed((error as Error).message, error, nextHost);
  } finally {
    deadline.stop();
    saveInFlight = Math.max(0, saveInFlight - 1);
    notifySaveListeners();
  }
};
