/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useConnectionProbeState } from "@/hooks/useConnectionState";

/** What the background probe found while Demo Mode is on. It alone follows the probe timestamps. */
export const DemoProbeNote = () => {
  const { lastProbeSucceededAtMs, lastProbeFailedAtMs, lastProbeError } = useConnectionProbeState();
  if (lastProbeSucceededAtMs) return <>Real device detected during probe.</>;
  if (lastProbeFailedAtMs) return <>No real device detected in recent probe.</>;
  return <>{lastProbeError ?? "Waiting for initial probe."}</>;
};
