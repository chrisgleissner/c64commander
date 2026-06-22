/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Plus, Settings, Wifi } from "lucide-react";
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
import { persistDiscoveredDevice } from "@/lib/deviceDiscovery/discoveryManager";
import { formatDiscoveredDeviceSubtitle, formatDiscoveredDeviceTitle } from "@/lib/deviceDiscovery/display";
import type { DeviceDiscoveryCandidate } from "@/lib/deviceDiscovery/types";
import { setPasswordForDevice } from "@/lib/secureStorage";
import { reportUserError } from "@/lib/uiErrors";

const isOfflineSwitchResult = (value: unknown): value is { ok: false; error?: string | null } =>
  typeof value === "object" && value !== null && "ok" in value && (value as { ok?: unknown }).ok === false;

const isAutomaticDiscoveryTrigger = (trigger: string | null) => trigger === "startup" || trigger === "resume";

const buildDiscoveryDialogKey = (completedAt: string | null, candidates: DeviceDiscoveryCandidate[]) =>
  `${completedAt ?? "unknown"}:${candidates.map((candidate) => candidate.id).join("|")}`;

type PasswordIntent = {
  candidate: DeviceDiscoveryCandidate;
  action: "save" | "use";
};

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

  const discoveryKey = useMemo(
    () => buildDiscoveryDialogKey(deviceDiscovery.completedAt, deviceDiscovery.candidates),
    [deviceDiscovery.candidates, deviceDiscovery.completedAt],
  );
  const candidates = deviceDiscovery.candidates;
  const shouldOffer =
    deviceDiscovery.phase === "complete" &&
    candidates.length > 0 &&
    isAutomaticDiscoveryTrigger(deviceDiscovery.trigger) &&
    connection.state !== "DEMO_ACTIVE";
  const open = shouldOffer && dismissedKey !== discoveryKey;

  const dismissCurrentDiscovery = () => {
    setDismissedKey(discoveryKey);
    setBusyCandidateId(null);
    setPasswordIntent(null);
    setPasswordInput("");
    setPasswordError(null);
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

  if (!shouldOffer) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) dismissCurrentDiscovery();
      }}
    >
      <DialogContent closeTestId="startup-device-discovery-close" surface="medium">
        <DialogHeader>
          <DialogTitle>C64 Ultimate devices found</DialogTitle>
          <DialogDescription>
            Choose a device to use now, save one for later, or enter an address in Settings.
          </DialogDescription>
          <p className="text-sm text-muted-foreground">
            We found devices on your network. Choose one to use now, or save one for later. You can still enter an
            address in Settings.
          </p>
        </DialogHeader>

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
                  <p className="truncate text-xs text-muted-foreground">{formatDiscoveredDeviceSubtitle(candidate)}</p>
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

        {passwordIntent ? (
          <div className="border-t border-border/70 px-4 py-3 sm:px-6" data-testid="startup-device-password-panel">
            <div className="space-y-2">
              <Label htmlFor="startup-device-password" className="text-sm">
                Network password
              </Label>
              <Input
                id="startup-device-password"
                type="password"
                value={passwordInput}
                onChange={(event) => {
                  setPasswordInput(event.target.value);
                  setPasswordError(null);
                }}
                placeholder={formatDiscoveredDeviceTitle(passwordIntent.candidate)}
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
                    setPasswordInput("");
                    setPasswordError(null);
                  }}
                  disabled={Boolean(busyCandidateId)}
                  data-testid="startup-device-password-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleConfirmPassword()}
                  disabled={Boolean(busyCandidateId)}
                  data-testid="startup-device-password-confirm"
                >
                  {passwordIntent.action === "save" ? "Save Device" : "Use Device"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
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
