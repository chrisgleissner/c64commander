/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isSidPlayerActive } from "@/lib/appMode/appModeStore";
import { addLog } from "@/lib/logging";

export type DeviceTrafficChannel = "rest" | "ftp" | "telnet" | "discovery" | "udp";

export const SID_PLAYER_TRAFFIC_BLOCKED_PREFIX = "SID Player blocked device traffic";

export class SidPlayerTrafficBlockedError extends Error {
  readonly channel: DeviceTrafficChannel;
  readonly detail: Record<string, unknown>;

  constructor(channel: DeviceTrafficChannel, detail: Record<string, unknown>) {
    super(`${SID_PLAYER_TRAFFIC_BLOCKED_PREFIX}: ${channel}`);
    this.name = "SidPlayerTrafficBlockedError";
    this.channel = channel;
    this.detail = detail;
  }
}

const loggedChannels = new Set<DeviceTrafficChannel>();

export const resetDeviceTrafficGateForTests = (): void => {
  loggedChannels.clear();
};

export const assertDeviceTrafficAllowed = (
  channel: DeviceTrafficChannel,
  detail: Record<string, unknown> = {},
): void => {
  if (!isSidPlayerActive()) return;
  const error = new SidPlayerTrafficBlockedError(channel, detail);
  if (!loggedChannels.has(channel)) {
    loggedChannels.add(channel);
    addLog("warn", error.message, { channel, ...detail, stack: error.stack });
  }
  throw error;
};
