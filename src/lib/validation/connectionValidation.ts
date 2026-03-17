/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// RFC 952 / 1123 hostname: labels separated by dots, each label starts and ends
// with an alphanumeric character and may contain hyphens.
const HOSTNAME_PATTERN =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

// Simplified IPv6: hex digits and colons only (covers full, compressed, and link-local forms).
const IPV6_PATTERN = /^[0-9a-fA-F:]{2,39}$/;

const parseHostAndPort = (input: string): { host: string; port: number | null } | null => {
  // Bracketed IPv6 address: [addr] or [addr]:port
  if (input.startsWith("[")) {
    const closeBracket = input.indexOf("]");
    if (closeBracket === -1) return null;
    const host = input.slice(1, closeBracket);
    const rest = input.slice(closeBracket + 1);
    if (rest === "") return { host, port: null };
    if (!rest.startsWith(":")) return null;
    const portStr = rest.slice(1);
    const port = Number(portStr);
    if (!portStr || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host, port };
  }

  // Bare IPv6: multiple colons means no port suffix is possible without brackets
  const colonCount = (input.match(/:/g) ?? []).length;
  if (colonCount > 1) return { host: input, port: null };

  // Hostname or IPv4, with optional single :port suffix
  const colonIdx = input.indexOf(":");
  if (colonIdx === -1) return { host: input, port: null };
  const portStr = input.slice(colonIdx + 1);
  const port = Number(portStr);
  if (!portStr || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: input.slice(0, colonIdx), port };
};

/**
 * Validates a device hostname, IPv4, or IPv6 address entered by the user.
 * Accepts an optional port suffix for hostnames and IPv4 (e.g. "c64u:8064",
 * "192.168.1.1:80"). IPv6 addresses may be bare ("fe80::1") or bracketed with
 * an optional port ("[fe80::1]:8064").
 *
 * Returns null when the value is valid or empty (empty falls back to the
 * application default at save time). Returns an error message string when
 * the value is non-empty but not a recognisable hostname or IP address.
 */
export const validateDeviceHost = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = parseHostAndPort(trimmed);
  if (!parsed) return "Enter a valid hostname or IP address (optionally with :port)";
  const { host } = parsed;

  const ipv4Match = IPV4_PATTERN.exec(host);
  if (ipv4Match) {
    const octets = [ipv4Match[1], ipv4Match[2], ipv4Match[3], ipv4Match[4]].map(Number);
    if (octets.every((n) => n >= 0 && n <= 255)) return null;
    return "Invalid IP address — each octet must be 0–255";
  }

  if (IPV6_PATTERN.test(host) && host.includes(":")) return null;

  if (HOSTNAME_PATTERN.test(host) && host.length <= 253) return null;

  return "Enter a valid hostname or IP address (optionally with :port)";
};
