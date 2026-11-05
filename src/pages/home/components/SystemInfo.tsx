/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Info } from "lucide-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useConnectionState } from "@/hooks/useConnectionState";
import { DEMO_MODE_DEVICE_LABEL } from "@/lib/connection/demoModeLabels";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { getBuildInfo } from "@/lib/buildInfo";
import { cn } from "@/lib/utils";

/**
 * `appVersionOnly` is Home's offline arrangement (spec.md section 6.1): with nothing connected, the
 * device and firmware rows would both read "Not connected", which is two rows saying what the
 * Connect card above already says.
 */
export function SystemInfo({ appVersionOnly = false }: { appVersionOnly?: boolean } = {}) {
  const { status } = useC64Connection();
  const { state: connectionState } = useConnectionState();
  const { profile } = useDisplayProfile();
  const buildInfo = getBuildInfo();
  const disconnected = !status.isConnected;
  const deviceValue = disconnected
    ? "Not connected"
    : connectionState === "DEMO_ACTIVE"
      ? DEMO_MODE_DEVICE_LABEL
      : status.deviceInfo?.hostname || status.deviceInfo?.product || "Not available";
  const firmwareValue = disconnected ? "Not connected" : status.deviceInfo?.firmware_version || "Not available";
  const version = buildInfo.versionLabel || "Not available";

  return (
    <CollapsibleSection
      scope="home"
      id="system-info"
      title="System info"
      summary="Device and build details"
      icon={Info}
      badge={<span data-testid="home-system-version">{version}</span>}
      testId="home-system-info"
      toggleTestId="home-system-info-toggle"
    >
      {appVersionOnly ? null : (
        <div className="space-y-2 p-4 pt-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="flex min-w-0 max-w-full shrink-0 items-baseline gap-1.5">
              <span className="shrink-0 text-muted-foreground">Device</span>
              <span className="min-w-0 truncate font-semibold text-foreground" data-testid="home-system-device">
                {deviceValue}
              </span>
            </span>
            <span className="flex min-w-0 max-w-full shrink-0 items-baseline gap-1.5">
              <span className="shrink-0 text-muted-foreground">Firmware</span>
              <span className="min-w-0 truncate font-semibold text-foreground" data-testid="home-system-firmware">
                {firmwareValue}
              </span>
            </span>
          </div>
          <div
            className={cn(
              "grid gap-x-4 gap-y-1 text-xs text-muted-foreground",
              profile === "compact" ? "grid-cols-1" : "grid-cols-2",
            )}
          >
            <div className="flex items-center gap-1">
              <span className="shrink-0 whitespace-nowrap">Git</span>
              <span className="min-w-0 truncate font-semibold text-foreground" data-testid="home-system-git">
                {buildInfo.gitShaShort || "Not available"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="shrink-0 whitespace-nowrap">Build</span>
              <span className="min-w-0 truncate font-semibold text-foreground" data-testid="home-system-build-time">
                {buildInfo.buildTimeUtc}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="shrink-0 whitespace-nowrap">FPGA</span>
              <span className="min-w-0 truncate font-semibold text-foreground" data-testid="home-system-fpga">
                {disconnected ? "Not available" : status.deviceInfo?.fpga_version || "Not available"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="shrink-0 whitespace-nowrap">Core</span>
              <span className="min-w-0 truncate font-semibold text-foreground" data-testid="home-system-core">
                {disconnected ? "Not available" : status.deviceInfo?.core_version || "Not available"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="shrink-0 whitespace-nowrap">Core ID</span>
              <span className="min-w-0 truncate font-semibold text-foreground" data-testid="home-system-core-id">
                {disconnected ? "Not available" : status.deviceInfo?.unique_id || "Not available"}
              </span>
            </div>
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}
