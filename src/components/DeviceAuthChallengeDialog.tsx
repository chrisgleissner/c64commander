/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
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
import { useAuthChallenge } from "@/lib/auth/authChallenge";
import { cancelAuthChallenge, submitAuthChallengePassword } from "@/lib/auth/authChallengeController";

/**
 * App-wide popup raised whenever a device returns Forbidden/Unauthorized
 * (HTTP 401/403) from any call — health check, config, play, drives, etc. It
 * names the affected device, asks for the network password, and on submit
 * stores the password, re-applies the runtime config, and re-probes. Wrong
 * password re-prompts. Mounted once at the app root so it is reachable from any
 * screen in both variants. The masked input is never logged.
 */
export function DeviceAuthChallengeDialog() {
  const challenge = useAuthChallenge();
  const [password, setPassword] = useState("");

  const open = challenge !== null;
  const submitting = challenge?.status === "submitting";

  // Clear the input whenever a *different* device's challenge opens so a stale
  // value can't be submitted to the wrong device.
  const deviceKey = challenge ? `${challenge.deviceId ?? ""}|${challenge.host ?? ""}` : null;
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (deviceKey !== lastKeyRef.current) {
      setPassword("");
      lastKeyRef.current = deviceKey;
    }
  }, [deviceKey]);

  const handleSubmit = async () => {
    const recovered = await submitAuthChallengePassword(password);
    if (recovered) setPassword("");
  };

  if (!challenge) return null;

  const describedBy = challenge.errorMessage ? "device-auth-challenge-error" : "device-auth-challenge-help";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) cancelAuthChallenge();
      }}
    >
      <DialogContent closeTestId="device-auth-challenge-close" surface="medium">
        <DialogHeader>
          <DialogTitle>Network password required</DialogTitle>
          <DialogDescription>
            {challenge.deviceLabel} refused the request because it needs its network password. The saved password is
            missing or no longer correct.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-2 px-4 py-3 sm:px-6" data-testid="device-auth-challenge-panel">
            <Label htmlFor="device-auth-challenge-input" className="text-sm">
              Network password
            </Label>
            <Input
              id="device-auth-challenge-input"
              type="password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              placeholder={challenge.deviceLabel}
              data-testid="device-auth-challenge-input"
              aria-invalid={challenge.errorMessage ? true : undefined}
              aria-describedby={describedBy}
            />
            {challenge.errorMessage ? (
              <p id="device-auth-challenge-error" className="text-xs text-destructive" role="alert">
                {challenge.errorMessage}
              </p>
            ) : (
              <p id="device-auth-challenge-help" className="text-xs text-muted-foreground">
                Enter the network password configured on {challenge.deviceLabel}.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={cancelAuthChallenge}
              data-testid="device-auth-challenge-cancel"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} data-testid="device-auth-challenge-submit">
              <KeyRound className={submitting ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
              {submitting ? "Connecting" : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
