/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, KeyRound, Plus, Settings, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useConnectionState } from "@/hooks/useConnectionState";
import { useDeviceDiscovery } from "@/hooks/useDeviceDiscovery";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { useSavedDeviceSwitching } from "@/hooks/useSavedDeviceSwitching";
import { buildDeviceHostWithHttpPort } from "@/lib/c64api/hostConfig";
import { isAuthRequiredError } from "@/lib/c64api/transportErrors";
import { probeDeviceReachability, type ProbeInfoResult } from "@/lib/connection/connectionManager";
import { persistDiscoveredDevice } from "@/lib/deviceDiscovery/discoveryManager";
import { formatDiscoveredDeviceSubtitle, formatDiscoveredDeviceTitle } from "@/lib/deviceDiscovery/display";
import type { DeviceDiscoveryCandidate } from "@/lib/deviceDiscovery/types";
import { splitSavedDeviceHostAndHttpPort } from "@/lib/savedDevices/host";
import { addSavedDevice, resolveCanonicalProductFamilyCode, updateSavedDevice } from "@/lib/savedDevices/store";
import { setPasswordForDevice } from "@/lib/secureStorage";
import { reportUserError } from "@/lib/uiErrors";

const DEFAULT_FTP_PORT = 21;
const DEFAULT_TELNET_PORT = 23;

const isOfflineSwitchResult = (value: unknown): value is { ok: false; error?: string | null } =>
  typeof value === "object" && value !== null && "ok" in value && (value as { ok?: unknown }).ok === false;

const isAutomaticDiscoveryTrigger = (trigger: string | null) => trigger === "startup" || trigger === "resume";

const buildDiscoveryDialogKey = (completedAt: string | null, candidates: DeviceDiscoveryCandidate[]) =>
  `${completedAt ?? "unknown"}:${candidates.map((candidate) => candidate.id).join("|")}`;

type PasswordIntent = {
  candidate: DeviceDiscoveryCandidate;
  action: "save" | "use";
};

type ManualPasswordTarget = {
  id: string;
  host: string;
  httpPort: number;
  deviceHost: string;
};

const normalizeHostKey = (host: string) => host.trim().toLowerCase();

const buildManualDeviceId = (host: string, httpPort: number) =>
  `manual-${
    host
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "device"
  }-${httpPort}`;

export function DeviceDiscoveryInterstitial() {
  const navigate = useNavigate();
  const deviceDiscovery = useDeviceDiscovery();
  const connection = useConnectionState();
  const savedDevices = useSavedDevices();
  const switchSavedDevice = useSavedDeviceSwitching();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [savedCandidateIds, setSavedCandidateIds] = useState<ReadonlySet<string>>(() => new Set());
  const [passwordIntent, setPasswordIntent] = useState<PasswordIntent | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [manualHostInput, setManualHostInput] = useState("");
  const [manualPasswordTarget, setManualPasswordTarget] = useState<ManualPasswordTarget | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const discoveryKey = useMemo(
    () => buildDiscoveryDialogKey(deviceDiscovery.completedAt, deviceDiscovery.candidates),
    [deviceDiscovery.candidates, deviceDiscovery.completedAt],
  );
  const candidates = deviceDiscovery.candidates;
  const hasCandidates = candidates.length > 0;
  const shouldOffer =
    deviceDiscovery.phase === "complete" &&
    isAutomaticDiscoveryTrigger(deviceDiscovery.trigger) &&
    connection.state !== "DEMO_ACTIVE";
  const open = shouldOffer && dismissedKey !== discoveryKey;

  const dismissCurrentDiscovery = () => {
    setDismissedKey(discoveryKey);
    setBusyCandidateId(null);
    setPasswordIntent(null);
    setPasswordInput("");
    setPasswordError(null);
    setManualHostInput("");
    setManualPasswordTarget(null);
    setManualBusy(false);
    setManualError(null);
  };

  const hasUsableSavedPassword = (candidate: DeviceDiscoveryCandidate) => {
    const savedDeviceId = candidate.alreadySavedDeviceId;
    if (!savedDeviceId) return false;
    return Boolean(savedDevices.devices.find((device) => device.id === savedDeviceId)?.hasPassword);
  };

  const requiresPasswordPrompt = (candidate: DeviceDiscoveryCandidate) =>
    candidate.requiresPassword && !hasUsableSavedPassword(candidate);

  const openPasswordPrompt = (candidate: DeviceDiscoveryCandidate, action: PasswordIntent["action"]) => {
    setPasswordIntent({ candidate, action });
    setPasswordInput("");
    setPasswordError(null);
  };

  const saveCandidate = async (candidate: DeviceDiscoveryCandidate, password?: string) => {
    const persisted = persistDiscoveredDevice(candidate, {
      select: false,
      passwordPresent: Boolean(password),
    });
    if (password) {
      await setPasswordForDevice(persisted.deviceId, password);
    }
    setSavedCandidateIds((previous) => new Set(previous).add(candidate.id));
    toast({ title: "Device saved" });
  };

  const handleSaveCandidate = async (candidate: DeviceDiscoveryCandidate, password?: string) => {
    if (!password && requiresPasswordPrompt(candidate)) {
      openPasswordPrompt(candidate, "save");
      return false;
    }
    try {
      await saveCandidate(candidate, password);
      return true;
    } catch (error) {
      reportUserError({
        operation: "DEVICE_DISCOVERY_SAVE",
        title: "Unable to save discovered device",
        description: (error as Error).message,
        error,
        deviceHost: candidate.address,
      });
      return false;
    }
  };

  const handleUseCandidate = async (candidate: DeviceDiscoveryCandidate, password?: string) => {
    if (!password && requiresPasswordPrompt(candidate)) {
      openPasswordPrompt(candidate, "use");
      return false;
    }
    setBusyCandidateId(candidate.id);
    try {
      const persisted = persistDiscoveredDevice(candidate, {
        select: true,
        passwordPresent: Boolean(password),
      });
      if (password) {
        await setPasswordForDevice(persisted.deviceId, password);
      }
      const verification = await switchSavedDevice(persisted.deviceId);
      if (isOfflineSwitchResult(verification)) {
        throw new Error(
          verification.error ??
            `Unable to connect to ${persisted.host}. The device was discovered, but did not answer the follow-up connection check.`,
        );
      }
      toast({ title: "Discovered device selected" });
      dismissCurrentDiscovery();
      return true;
    } catch (error) {
      reportUserError({
        operation: "DEVICE_DISCOVERY_SELECT",
        title: "Unable to select discovered device",
        description: (error as Error).message,
        error,
        deviceHost: candidate.address,
      });
      return false;
    } finally {
      setBusyCandidateId(null);
    }
  };

  const handleConfirmPassword = async () => {
    if (manualPasswordTarget) {
      await handleConfirmManualPassword();
      return;
    }
    if (!passwordIntent) return;
    const password = passwordInput.trim();
    if (!password) {
      setPasswordError("Enter the network password for this device.");
      return;
    }
    setPasswordError(null);
    if (passwordIntent.action === "save") {
      const saved = await handleSaveCandidate(passwordIntent.candidate, password);
      if (saved) {
        setPasswordIntent(null);
        setPasswordInput("");
      }
      return;
    }
    const used = await handleUseCandidate(passwordIntent.candidate, password);
    if (used) {
      setPasswordIntent(null);
      setPasswordInput("");
    }
  };

  const resolveManualTarget = (): ManualPasswordTarget | null => {
    const trimmed = manualHostInput.trim();
    if (!trimmed) {
      setManualError("Enter a host or IP address.");
      return null;
    }
    const { host, httpPort } = splitSavedDeviceHostAndHttpPort(trimmed);
    return {
      id:
        savedDevices.devices.find((device) => normalizeHostKey(device.host) === normalizeHostKey(host))?.id ??
        buildManualDeviceId(host, httpPort),
      host,
      httpPort,
      deviceHost: buildDeviceHostWithHttpPort(host, httpPort),
    };
  };

  const persistManualDevice = async (
    target: ManualPasswordTarget,
    probe: ProbeInfoResult,
    password?: string,
  ): Promise<string> => {
    const existing = savedDevices.devices.find(
      (device) => normalizeHostKey(device.host) === normalizeHostKey(target.host),
    );
    const product = resolveCanonicalProductFamilyCode(probe.deviceInfo?.product);
    if (existing) {
      updateSavedDevice(existing.id, {
        host: target.host,
        httpPort: target.httpPort,
        lastKnownProduct: product,
        lastKnownHostname: probe.deviceInfo?.hostname ?? null,
        lastKnownUniqueId: probe.deviceInfo?.unique_id ?? null,
        ...(password ? { hasPassword: true } : {}),
      });
      if (password) {
        await setPasswordForDevice(existing.id, password);
      }
      return existing.id;
    }
    addSavedDevice({
      id: target.id,
      name: "",
      host: target.host,
      type: product ?? "",
      typeSource: "INFERRED",
      httpPort: target.httpPort,
      ftpPort: DEFAULT_FTP_PORT,
      telnetPort: DEFAULT_TELNET_PORT,
      lastKnownProduct: product,
      lastKnownHostname: probe.deviceInfo?.hostname ?? null,
      lastKnownUniqueId: probe.deviceInfo?.unique_id ?? null,
      hasPassword: Boolean(password),
    });
    if (password) {
      await setPasswordForDevice(target.id, password);
    }
    return target.id;
  };

  const switchToManualDevice = async (deviceId: string, host: string) => {
    const verification = await switchSavedDevice(deviceId);
    if (isOfflineSwitchResult(verification)) {
      throw new Error(verification.error ?? `Saved ${host}, but it did not answer the connection check.`);
    }
    toast({ title: "Device selected" });
    dismissCurrentDiscovery();
  };

  const handleManualConnect = async () => {
    const target = resolveManualTarget();
    if (!target) return;
    setManualBusy(true);
    setManualError(null);
    try {
      const probe = await probeDeviceReachability({ deviceHost: target.deviceHost });
      if (probe.ok) {
        const deviceId = await persistManualDevice(target, probe);
        await switchToManualDevice(deviceId, target.host);
        return;
      }
      if (isAuthRequiredError(probe.error)) {
        setManualPasswordTarget(target);
        setPasswordInput("");
        setPasswordError(null);
        return;
      }
      setManualError(probe.error ?? `Couldn't reach ${target.host}.`);
    } catch (error) {
      reportUserError({
        operation: "STARTUP_MANUAL_DEVICE_CONNECT",
        title: "Unable to connect to device",
        description: (error as Error).message,
        error,
        deviceHost: target.host,
      });
      setManualError((error as Error).message);
    } finally {
      setManualBusy(false);
    }
  };

  const handleConfirmManualPassword = async () => {
    if (!manualPasswordTarget) return;
    const password = passwordInput.trim();
    if (!password) {
      setPasswordError("Enter the network password for this device.");
      return;
    }
    setManualBusy(true);
    setPasswordError(null);
    try {
      const probe = await probeDeviceReachability({ deviceHost: manualPasswordTarget.deviceHost, password });
      if (!probe.ok) {
        setPasswordError(
          isAuthRequiredError(probe.error)
            ? "The device rejected that password."
            : (probe.error ?? "The device did not answer."),
        );
        return;
      }
      const deviceId = await persistManualDevice(manualPasswordTarget, probe, password);
      await switchToManualDevice(deviceId, manualPasswordTarget.host);
    } catch (error) {
      reportUserError({
        operation: "STARTUP_MANUAL_DEVICE_PASSWORD",
        title: "Unable to apply password",
        description: (error as Error).message,
        error,
        deviceHost: manualPasswordTarget.host,
      });
      setPasswordError((error as Error).message);
    } finally {
      setManualBusy(false);
    }
  };

  if (!shouldOffer) return null;

  const dialogTitle = hasCandidates ? "C64 systems found" : "No C64 systems found";
  const dialogDescription = hasCandidates
    ? "Choose one to control now, save one for later, or enter an address manually in Settings."
    : "Enter your C64 Ultimate host or IP address.";
  const passwordPanelOpen = Boolean(passwordIntent || manualPasswordTarget);
  const passwordPlaceholder = manualPasswordTarget
    ? manualPasswordTarget.host
    : passwordIntent
      ? formatDiscoveredDeviceTitle(passwordIntent.candidate)
      : "";
  const passwordConfirmLabel = manualPasswordTarget
    ? "Connect"
    : passwordIntent?.action === "save"
      ? "Save Device"
      : "Use Device";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) dismissCurrentDiscovery();
      }}
    >
      <DialogContent closeTestId="startup-device-discovery-close" surface="list-browser">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        {hasCandidates ? (
          <div className="max-h-[min(26rem,60vh)] space-y-2 overflow-y-auto px-4 py-3 sm:px-6">
            {candidates.map((candidate) => {
              const saved = Boolean(candidate.alreadySavedDeviceId) || savedCandidateIds.has(candidate.id);
              const busy = busyCandidateId === candidate.id;
              return (
                <div
                  key={candidate.id}
                  className="flex flex-col gap-3 rounded-lg border border-border/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`startup-discovered-device-${candidate.id}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {formatDiscoveredDeviceTitle(candidate)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDiscoveredDeviceSubtitle(candidate)}
                    </p>
                    {candidate.requiresPassword ? (
                      <p className="text-xs text-muted-foreground">Password required</p>
                    ) : null}
                    {saved ? <p className="text-xs text-muted-foreground">Already saved</p> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSaveCandidate(candidate)}
                      disabled={saved || Boolean(busyCandidateId)}
                      data-testid={`startup-save-discovered-device-${candidate.id}`}
                    >
                      {saved ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      {saved ? "Saved" : "Save"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleUseCandidate(candidate)}
                      disabled={Boolean(busyCandidateId)}
                      data-testid={`startup-use-discovered-device-${candidate.id}`}
                    >
                      <Wifi className={busy ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
                      {busy ? "Connecting" : "Use"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <form
            className="space-y-3 px-4 py-3 sm:px-6"
            data-testid="startup-manual-device-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void handleManualConnect();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="startup-manual-device-host" className="text-sm">
                Host or IP
              </Label>
              <Input
                id="startup-manual-device-host"
                value={manualHostInput}
                onChange={(event) => {
                  const nextHostInput = event.target.value;
                  setManualHostInput(nextHostInput);
                  setManualError(null);
                  if (
                    manualPasswordTarget &&
                    normalizeHostKey(manualPasswordTarget.host) !== normalizeHostKey(nextHostInput)
                  ) {
                    setManualPasswordTarget(null);
                    setPasswordInput("");
                    setPasswordError(null);
                  }
                }}
                autoFocus
                placeholder="c64u or 192.168.1.64"
                disabled={manualBusy}
                data-testid="startup-manual-device-host-input"
                aria-invalid={manualError ? true : undefined}
                aria-describedby={manualError ? "startup-manual-device-error" : "startup-manual-device-help"}
              />
              {manualError ? (
                <p id="startup-manual-device-error" className="text-xs text-destructive" role="alert">
                  {manualError}
                </p>
              ) : (
                <p id="startup-manual-device-help" className="text-xs text-muted-foreground">
                  Use the name shown in the C64 Ultimate network menu, or its IP.
                </p>
              )}
            </div>
            {!manualPasswordTarget ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={manualBusy} data-testid="startup-manual-device-connect">
                  <Wifi className={manualBusy ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
                  {manualBusy ? "Checking" : "Connect"}
                </Button>
              </div>
            ) : null}
          </form>
        )}

        {passwordPanelOpen ? (
          <div className="border-t border-border/70 px-4 py-3 sm:px-6" data-testid="startup-device-password-panel">
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleConfirmPassword();
              }}
            >
              <Label htmlFor="startup-device-password" className="text-sm">
                Network password
              </Label>
              <Input
                id="startup-device-password"
                type="password"
                autoFocus
                value={passwordInput}
                onChange={(event) => {
                  setPasswordInput(event.target.value);
                  setPasswordError(null);
                }}
                placeholder={passwordPlaceholder}
                disabled={manualBusy}
                data-testid="startup-device-password-input"
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? "startup-device-password-error" : "startup-device-password-help"}
              />
              {passwordError ? (
                <p id="startup-device-password-error" className="text-xs text-destructive" role="alert">
                  {passwordError}
                </p>
              ) : (
                <p id="startup-device-password-help" className="text-xs text-muted-foreground">
                  This is the device network password configured on the C64 Ultimate.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPasswordIntent(null);
                    setManualPasswordTarget(null);
                    setPasswordInput("");
                    setPasswordError(null);
                  }}
                  disabled={Boolean(busyCandidateId) || manualBusy}
                  data-testid="startup-device-password-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={Boolean(busyCandidateId) || manualBusy}
                  data-testid="startup-device-password-confirm"
                >
                  {manualPasswordTarget ? (
                    <KeyRound className={manualBusy ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
                  ) : null}
                  {manualBusy ? "Connecting" : passwordConfirmLabel}
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        <DialogFooter>
          {hasCandidates ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                dismissCurrentDiscovery();
                navigate("/settings");
              }}
              data-testid="startup-device-discovery-open-settings"
            >
              <Settings className="h-4 w-4" />
              Open Settings
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={dismissCurrentDiscovery}
            data-testid="startup-device-discovery-dismiss"
          >
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
