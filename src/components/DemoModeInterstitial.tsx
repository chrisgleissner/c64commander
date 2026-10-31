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
import { declineDemoMode, pinDemoModeByUserChoice } from "@/lib/connection/connectionManager";
import { resolveDeviceHostFromStorage } from "@/lib/c64api";
import { saveConfiguredHostAndRetry } from "@/lib/connection/hostEdit";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { loadStartupMode } from "@/lib/appMode/appModeStore";
import { enterSidPlayer } from "@/lib/appMode/appModeTransitions";
import { MODE_COPY } from "@/lib/appMode/copy";
import { hasNeverConnectedDevice } from "@/lib/connection/demoOfferMemory";
import { addErrorLog } from "@/lib/logging";

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
 * On a 320x427 panel above a gesture bar the offer has about 330px. Five lines of prose left the
 * second button half off screen, and a tap on its hidden half reached the backdrop, which declines.
 * With the Pixel's status bar as well the dialog is 283px tall, and a third line of prose ran under
 * the buttons, which stay put while the prose scrolls: two lines is what fits.
 */
const NO_NETWORK_MESSAGE_COMPACT = "No network. Demo Mode can simulate a C64.";
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
  const firstRun = loadStartupMode() === "default" && hasNeverConnectedDevice();
  const notFoundSuffix = compact ? NOT_FOUND_SUFFIX_COMPACT : NOT_FOUND_SUFFIX;
  const noNetworkMessage = compact ? NO_NETWORK_MESSAGE_COMPACT : NO_NETWORK_MESSAGE;
  const firstRunCopy = MODE_COPY.firstRun;
  const firstRunBody = noNetwork
    ? compact
      ? firstRunCopy.noNetworkCompactBody
      : firstRunCopy.noNetworkBody
    : compact
      ? firstRunCopy.compactBody
      : firstRunCopy.body;
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
      // Closing the offer (×, Back, a tap outside) turns it down: the simulated device is already
      // standing in behind it, and leaving it there would accept an offer the user refused.
      onOpenChange={(open) => {
        if (!open) void declineDemoMode();
      }}
    >
      {/* Compact: the default 24 px padding and 16 px gaps took 80 of the 283 px this offer gets. */}
      <DialogContent className={compact ? "gap-2 p-4" : undefined}>
        <DialogHeader>
          <DialogTitle>{firstRun ? MODE_COPY.firstRun.title : "Demo Mode"}</DialogTitle>
          <DialogDescription data-testid="demo-interstitial-description">
            {firstRun ? firstRunBody : message}
          </DialogDescription>
        </DialogHeader>
        <p className="px-4 pt-1 text-sm text-muted-foreground sm:px-6" data-testid="demo-interstitial-message">
          {firstRun ? (
            firstRunBody
          ) : noNetwork ? (
            noNetworkMessage
          ) : (
            <>
              {NOT_FOUND_PREFIX} <strong data-testid="demo-interstitial-hostname">{attemptedHost}</strong>
              {notFoundSuffix}
            </>
          )}
        </p>
        {noNetwork || (firstRun && compact) ? null : (
          <div className="space-y-2 px-4 py-2 sm:px-6">
            <Label htmlFor="demo-device-host">C64U hostname / IP</Label>
            <Input
              id="demo-device-host"
              data-testid="demo-interstitial-host-input"
              data-t9-mode="hostname"
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
        {/* No field to type into, so the buttons can stay put while prose that wraps further scrolls under them. */}
        <DialogFooter
          className={noNetwork ? "sticky bottom-0 z-10 border-t border-border bg-background pt-3" : undefined}
        >
          {/* Primary first: stacked on a phone it is the one action sure to be on screen when the offer opens. */}
          <div className="flex flex-col gap-2 w-full sm:flex-row-reverse sm:justify-start">
            {firstRun ? (
              <Button
                variant="default"
                data-testid="demo-interstitial-use-sid-player"
                onClick={() => {
                  enterSidPlayer().catch((error: unknown) =>
                    addErrorLog("Entering SID Player from the first-run offer failed", { error: String(error) }),
                  );
                }}
              >
                {MODE_COPY.firstRun.useSidPlayer}
              </Button>
            ) : null}
            {firstRun ? (
              <Button
                variant="secondary"
                data-testid="demo-interstitial-continue"
                onClick={() => {
                  void pinDemoModeByUserChoice();
                }}
              >
                {MODE_COPY.firstRun.tryDemoMode}
              </Button>
            ) : (
              <Button
                variant="default"
                data-testid="demo-interstitial-continue"
                onClick={() => {
                  void pinDemoModeByUserChoice();
                }}
              >
                Continue in Demo Mode
              </Button>
            )}
            {noNetwork || (firstRun && compact) ? null : (
              <Button variant="secondary" data-testid="demo-interstitial-save-retry" onClick={handleSaveAndRetry}>
                Save & retry
              </Button>
            )}
            <Button
              variant="outline"
              data-testid="demo-interstitial-retry"
              onClick={() => {
                void declineDemoMode({ retry: "manual" });
              }}
            >
              {firstRun ? MODE_COPY.firstRun.retry : noNetwork ? "Try again" : "Retry connection"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
