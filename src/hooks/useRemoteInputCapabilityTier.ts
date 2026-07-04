/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { useC64Connection } from "@/hooks/useC64Connection";
import { getC64API } from "@/lib/c64api";
import { probeMachineInputCapability, type MachineInputCapabilityStatus } from "@/lib/deviceCapabilities";
import { resolveRemoteInputTier, type RemoteInputTier } from "@/lib/remoteInput/capabilityTier";
import { getSelectedSavedDevice } from "@/lib/savedDevices/store";
import { addErrorLog, buildErrorLogDetails } from "@/lib/logging";

export type RemoteInputCapabilityState = {
  tier: RemoteInputTier;
  loading: boolean;
  /**
   * HARD15-006: whether `tier` reflects an actual, definitive probe result
   * rather than the default/reset state - `{tier: "kernal-fallback", loading:
   * false}` is otherwise indistinguishable between "genuinely probed and
   * unsupported" and "not yet probed / mid-blip", which used to bounce the
   * sheet's smart-default effect out of Joystick mode on every transient
   * disconnect. Composes with HARD15-002: an `error`/`auth-required` probe
   * outcome is also uncached, so it is treated the same as "not yet probed"
   * here too.
   */
  resolved: boolean;
};

const isDefinitiveStatus = (status: MachineInputCapabilityStatus): boolean =>
  status !== "error" && status !== "auth-required";

// HARD12-017: resolves which remote-input tier a connected device supports.
// Defaults to the conservative "kernal-fallback" tier while the probe is
// in flight or the device is not connected — never assume "full" ahead of a
// confirmed 200 from GET /v1/machine:input. `enabled` keeps the probe out of
// the hot path: the Home tile mounts this sheet ahead of the user ever
// opening it, so the network probe only fires while the sheet is actually
// open, not merely rendered dark behind the feature flag.
export const useRemoteInputCapabilityTier = (enabled = true): RemoteInputCapabilityState => {
  const { status } = useC64Connection();
  const [state, setState] = useState<RemoteInputCapabilityState>({
    tier: "kernal-fallback",
    loading: false,
    resolved: false,
  });

  const deviceInfo = status.deviceInfo;
  const isConnected = status.isConnected;
  const coreVersion = deviceInfo?.core_version ?? null;
  const firmwareVersion = deviceInfo?.firmware_version ?? null;

  useEffect(() => {
    if (!enabled || !isConnected) {
      setState({ tier: "kernal-fallback", loading: false, resolved: false });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));
    const deviceId = getSelectedSavedDevice()?.id ?? null;
    probeMachineInputCapability({
      api: getC64API(),
      deviceId,
      firmwareVersion,
      coreVersion,
    })
      .then((result) => {
        if (cancelled) return;
        setState({
          tier: resolveRemoteInputTier(result.status),
          loading: false,
          resolved: isDefinitiveStatus(result.status),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        addErrorLog(
          "Remote input capability probe failed",
          buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), { deviceId }),
        );
        setState({ tier: "kernal-fallback", loading: false, resolved: false });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, isConnected, coreVersion, firmwareVersion]);

  return state;
};
