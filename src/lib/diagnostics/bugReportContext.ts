/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { getBuildInfo, type BuildInfo } from "@/lib/buildInfo";
import { buildNetworkSnapshot, type NetworkSnapshot } from "@/lib/diagnostics/networkSnapshot";

type DeviceInfoLike = {
  product?: string | null;
  firmware?: string | null;
  firmware_version?: string | null;
  fpga?: string | null;
  fpga_version?: string | null;
  core?: string | null;
  core_version?: string | null;
};

export type DiagnosticsBugReportContextInput = {
  activeDeviceHost?: string | null;
  activeDeviceLabel?: string | null;
  deviceInfo?: DeviceInfoLike | null;
  deviceSafetyResolution?: unknown;
  buildInfo?: BuildInfo;
  platform?: string;
  userAgent?: string | null;
  networkSnapshot?: NetworkSnapshot;
};

const getUserAgent = () => (typeof navigator === "undefined" ? null : navigator.userAgent);

export const parseAndroidVersionFromUserAgent = (userAgent: string | null | undefined) => {
  const match = /Android\s+([^;)]+)/i.exec(userAgent ?? "");
  return match?.[1]?.trim() || null;
};

export const buildDiagnosticsBugReportContext = ({
  activeDeviceHost = null,
  activeDeviceLabel = null,
  deviceInfo = null,
  deviceSafetyResolution = null,
  buildInfo = getBuildInfo(),
  platform = Capacitor.getPlatform(),
  userAgent = getUserAgent(),
  networkSnapshot = buildNetworkSnapshot(),
}: DiagnosticsBugReportContextInput) => ({
  app: {
    version: buildInfo.appVersion,
    versionLabel: buildInfo.versionLabel,
    gitSha: buildInfo.gitSha,
    gitShaShort: buildInfo.gitShaShort,
    buildTimeUtc: buildInfo.buildTimeUtc,
  },
  platform: {
    capacitorPlatform: platform,
    androidVersion: platform === "android" ? parseAndroidVersionFromUserAgent(userAgent) : null,
    userAgent,
  },
  activeDevice: {
    host: activeDeviceHost,
    label: activeDeviceLabel,
    product: deviceInfo?.product ?? null,
    firmware: deviceInfo?.firmware ?? deviceInfo?.firmware_version ?? null,
    fpga: deviceInfo?.fpga ?? deviceInfo?.fpga_version ?? null,
    core: deviceInfo?.core ?? deviceInfo?.core_version ?? null,
  },
  deviceSafety: deviceSafetyResolution,
  networkSnapshot,
});
