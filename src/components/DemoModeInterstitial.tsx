/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConnectionState } from "@/hooks/useConnectionState";
import {
  dismissDemoInterstitial,
  discoverConnection,
  pinDemoModeByUserChoice,
} from "@/lib/connection/connectionManager";
import { resolveDeviceHostFromStorage } from "@/lib/c64api";
import { saveConfiguredHostAndRetry } from "@/lib/connection/hostEdit";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";

/**
 * The dialog's words, in one place.
 *
 * `DialogDescription` is sr-only in this app (see components/ui/dialog.tsx), so the same sentences
 * are rendered twice — once as the accessible description, once as visible body copy that bolds
 * the hostname. Splitting at the hostname is what lets both come from these constants instead of
 * being written out twice and drifting apart.
 */
const NOT_FOUND_PREFIX = "No C64U was found at";
const NOT_FOUND_SUFFIX =
  ". You can continue in Demo Mode using the built-in simulated device, or retry connecting to real hardware.";
const NO_NETWORK_MESSAGE =
  "This device has no network connection, so no C64U can be reached. You can continue in Demo Mode using the " +
  "built-in simulated device, or connect to a network and try again.";

/*
 * Shorter copy for the compact profile, saying the same thing.
 *
 * This is the first screen most people see, and on a 320x427 panel the full wording ran to nine
 * lines and pushed "Continue in Demo Mode" below the fold. The dialog scrolls, so the button was
 * reachable, but a first-run offer whose primary action needs a scroll to find is a poor way to
 * meet the app. Both buttons fit above the fold with this.
 */
const NO_NETWORK_MESSAGE_COMPACT =
  "No network, so no C64U can be reached. Demo Mode runs the app against a simulated device on this phone.";
const NOT_FOUND_SUFFIX_COMPACT = ". Demo Mode runs the app against a simulated device on this phone.";

export function DemoModeInterstitial() {
  const { demoInterstitialVisible, demoInterstitialReason } = useConnectionState();
  const { profile } = useDisplayProfile();
  const [deviceHostInput, setDeviceHostInput] = useState("");
  const [hostError, setHostError] = useState<string | null>(null);

  useEffect(() => {
    if (demoInterstitialVisible) {
      setDeviceHostInput(resolveDeviceHostFromStorage());
      setHostError(null);
    }
  }, [demoInterstitialVisible]);

  if (!demoInterstitialVisible) return null;

  const attemptedHost = resolveDeviceHostFromStorage();
  // With no network there is no host to reach and no scan to repeat, so the dialog drops the
  // hostname field and Save & retry: offering either would invite the user to answer a question
  // that cannot change the outcome until they turn a network back on.
  const noNetwork = demoInterstitialReason === "no-network";
  const compact = profile === "compact";
  const notFoundSuffix = compact ? NOT_FOUND_SUFFIX_COMPACT : NOT_FOUND_SUFFIX;
  const noNetworkMessage = compact ? NO_NETWORK_MESSAGE_COMPACT : NO_NETWORK_MESSAGE;
  const message = noNetwork ? noNetworkMessage : `${NOT_FOUND_PREFIX} ${attemptedHost}${notFoundSuffix}`;

  const handleSaveAndRetry = () => {
    try {
      saveConfiguredHostAndRetry(deviceHostInput, attemptedHost, {
        dismissInterstitial: true,
        trigger: "settings",
      });
      setHostError(null);
    } catch (error) {
      setHostError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog
      open={demoInterstitialVisible}
      onOpenChange={(open) => {
        if (!open) dismissDemoInterstitial();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Demo Mode</DialogTitle>
          <DialogDescription data-testid="demo-interstitial-description">{message}</DialogDescription>
        </DialogHeader>
        <p className="px-4 pt-1 text-sm text-muted-foreground sm:px-6" data-testid="demo-interstitial-message">
          {noNetwork ? (
            noNetworkMessage
          ) : (
            <>
              {NOT_FOUND_PREFIX} <strong data-testid="demo-interstitial-hostname">{attemptedHost}</strong>
              {notFoundSuffix}
            </>
          )}
        </p>
        {noNetwork ? null : (
          <div className="space-y-2 px-4 py-2 sm:px-6">
            <Label htmlFor="demo-device-host">C64U hostname / IP</Label>
            <Input
              id="demo-device-host"
              data-testid="demo-interstitial-host-input"
              value={deviceHostInput}
              onChange={(e) => {
                setDeviceHostInput(e.target.value);
                setHostError(null);
              }}
              placeholder={attemptedHost}
            />
            {hostError ? (
              <p className="text-xs text-destructive" data-testid="demo-interstitial-host-error">
                {hostError}
              </p>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <div className="flex flex-col gap-2 w-full sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              data-testid="demo-interstitial-retry"
              onClick={() => {
                dismissDemoInterstitial();
                void discoverConnection("manual");
              }}
            >
              {noNetwork ? "Try again" : "Retry connection"}
            </Button>
            {noNetwork ? null : (
              <Button variant="secondary" data-testid="demo-interstitial-save-retry" onClick={handleSaveAndRetry}>
                Save & retry
              </Button>
            )}
            <Button
              variant="default"
              data-testid="demo-interstitial-continue"
              onClick={() => {
                void pinDemoModeByUserChoice();
              }}
            >
              Continue in Demo Mode
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
