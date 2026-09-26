/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** The firmware's status for "No Operational Network Interface": its Ethernet port has no link or no address. */
const NO_ETHERNET_STATUS = 500;

/**
 * The sentence the Live View card shows when the device refused to start a stream.
 *
 * Streams leave only through the Ethernet port, so a device reached over Wi-Fi with no cable plugged
 * in answers every other request and refuses this one. Saying so is the only way the user finds out.
 */
export const describeStreamStartFailure = (error: unknown, stream: "audio" | "video"): string => {
  const status = (error as { c64uHttpStatus?: unknown } | null)?.c64uHttpStatus;
  if (status === NO_ETHERNET_STATUS) {
    return "The device's Ethernet port is not connected, and Live View streams leave only through it.";
  }
  return `Could not tell the device to start streaming ${stream}.`;
};
