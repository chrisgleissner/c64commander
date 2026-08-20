/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { getBuildInfo } from "@/lib/buildInfo";
import { cn } from "@/lib/utils";

export function SystemInfo() {
  const [expanded, setExpanded] = useState(false);
  const { status } = useC64Connection();
  const { profile } = useDisplayProfile();
  const buildInfo = getBuildInfo();
  const disconnected = !status.isConnected;
  const deviceValue = disconnected
    ? "Not connected"
    : status.deviceInfo?.hostname || status.deviceInfo?.product || "Not available";
  const firmwareValue = disconnected ? "Not connected" : status.deviceInfo?.firmware_version || "Not available";

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      type="button"
      onClick={() => setExpanded((prev) => !prev)}
      className="w-full text-left px-2 py-2"
      aria-expanded={expanded}
      data-testid="home-system-info"
      data-section-label="System info"
    >
      {/*
        Each label keeps its own value on the same line. As six independent spans in one wrapping
        flex row, a label could end one line and its value start the next: on a 320 px screen this
        read "App 0.9.8-rc4-9de8e Device / C64-Ultimate-716824 Firmware / 1.2.0" across three lines,
        which does not say which value belongs to which label. In compact each pair gets its own
        row; wider screens keep the single flowing line, where there is room for it.
      */}
      <div
        className={cn(
          "gap-x-4 text-sm",
          profile === "compact" ? "grid grid-cols-1 gap-y-0.5" : "flex flex-wrap items-center gap-y-1",
        )}
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-muted-foreground">App</span>
          <span className="min-w-0 truncate font-semibold text-foreground" data-testid="home-system-version">
            {buildInfo.versionLabel || "Not available"}
          </span>
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-muted-foreground">Device</span>
          <span className="min-w-0 truncate font-semibold text-foreground" data-testid="home-system-device">
            {deviceValue}
          </span>
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-muted-foreground">Firmware</span>
          <span className="min-w-0 truncate font-semibold text-foreground" data-testid="home-system-firmware">
            {firmwareValue}
          </span>
        </span>
      </div>
      {expanded && (
        // One column on the smallest screen: two columns leave about 108px each, and
        // the build timestamp beside its label squeezed "Build" down to 20px, where it
        // was set one letter to a line.
        //
        // One column was still not enough. CI measured "Build" needing 43px on a 42px
        // line and breaking after "Buil", because the flex row shrinks the label to fit
        // the timestamp beside it. The labels are shrink-0 so they keep their own width,
        // and the values truncate instead - a shortened build timestamp is still
        // recognisable, a label broken mid-word is not.
        <div
          className={cn(
            "mt-1 grid gap-x-4 gap-y-1 text-xs text-muted-foreground",
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
      )}
    </motion.button>
  );
}
