/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** Strip any port and normalise, so `192.168.1.15:80` and `192.168.1.15` compare equal. */
const hostOnly = (value: string): string => {
  const trimmed = value.trim();
  const lastColon = trimmed.lastIndexOf(":");
  // Leave IPv6 (multiple colons) alone; only strip a trailing :port from a host/IPv4.
  if (lastColon > 0 && trimmed.indexOf(":") === lastColon) return trimmed.slice(0, lastColon);
  return trimmed;
};

/**
 * Senders on our multicast group that are not the selected device. Every Ultimate defaults to the same
 * groups, so a machine another phone is watching sends into ours, heard as rough audio at the wrong
 * pitch. The native filter drops its packets by origin IP; the app names that machine but never stops
 * it, because it may be serving another phone.
 */
export const foreignSenders = (senders: readonly string[], expectedHost: string | null): string[] => {
  const expected = expectedHost ? hostOnly(expectedHost) : null;
  return senders.map(hostOnly).filter((ip) => ip.length > 0 && ip !== expected);
};

/** A sentence naming the other machines streaming into the group, for the Live View card. */
export const describeForeignSenders = (hosts: readonly string[]): string | null => {
  if (hosts.length === 0) return null;
  const list = hosts.join(", ");
  return hosts.length === 1
    ? `Another Ultimate at ${list} is also streaming into this group. Live View ignores it, but it shares your Wi-Fi.`
    : `Other Ultimates at ${list} are also streaming into this group. Live View ignores them, but they share your Wi-Fi.`;
};
