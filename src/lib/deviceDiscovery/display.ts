/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DeviceDiscoveryCandidate } from "@/lib/deviceDiscovery/types";

export const formatDiscoveredDeviceTitle = (candidate: DeviceDiscoveryCandidate) =>
  `${candidate.product}${candidate.hostname ? ` · ${candidate.hostname}` : ""}`;

export const formatDiscoveredDeviceVersion = (candidate: DeviceDiscoveryCandidate) =>
  [
    candidate.firmwareVersion ? `fw ${candidate.firmwareVersion}` : null,
    candidate.uniqueId ? `ID ${candidate.uniqueId}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

export const formatDiscoveredDeviceSubtitle = (candidate: DeviceDiscoveryCandidate) => {
  const version = formatDiscoveredDeviceVersion(candidate);
  return `${candidate.address}${version ? ` · ${version}` : ""}`;
};
