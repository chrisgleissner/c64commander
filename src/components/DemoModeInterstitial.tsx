/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConnectionState } from '@/hooks/useConnectionState';
import { dismissDemoInterstitial, discoverConnection } from '@/lib/connection/connectionManager';
import { resolveDeviceHostFromStorage } from '@/lib/c64api';
import { saveConfiguredHostAndRetry } from '@/lib/connection/hostEdit';

export function DemoModeInterstitial() {
  const { demoInterstitialVisible } = useConnectionState();
  const [deviceHostInput, setDeviceHostInput] = useState('');

  useEffect(() => {
    if (demoInterstitialVisible) {
      setDeviceHostInput(resolveDeviceHostFromStorage());
    }
  }, [demoInterstitialVisible]);

  if (!demoInterstitialVisible) return null;

  const attemptedHost = resolveDeviceHostFromStorage();

  const handleSaveAndRetry = () => {
    saveConfiguredHostAndRetry(deviceHostInput, attemptedHost, { dismissInterstitial: true, trigger: 'settings' });
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
          <DialogDescription>
            No C64U was found at <strong data-testid="demo-interstitial-hostname">{attemptedHost}</strong>. You can
            continue in Demo Mode using the built-in simulated device, or retry connecting to real hardware.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="demo-device-host">C64U Hostname / IP</Label>
          <Input
            id="demo-device-host"
            data-testid="demo-interstitial-host-input"
            value={deviceHostInput}
            onChange={(e) => setDeviceHostInput(e.target.value)}
            placeholder={attemptedHost}
          />
        </div>
        <DialogFooter>
          <div className="flex flex-col gap-2 w-full sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                dismissDemoInterstitial();
                void discoverConnection('manual');
              }}
            >
              Retry connection
            </Button>
            <Button
              variant="secondary"
              onClick={handleSaveAndRetry}
            >
              Save & Retry
            </Button>
            <Button
              variant="default"
              onClick={() => {
                dismissDemoInterstitial();
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
