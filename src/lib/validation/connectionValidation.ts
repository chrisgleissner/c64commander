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

/**
 * Validates a device hostname or IPv4 address entered by the user.
 *
 * Returns null when the value is valid or empty (empty falls back to the
 * application default at save time). Returns an error message string when
 * the value is non-empty but not a recognisable hostname or IPv4 address.
 */
export const validateDeviceHost = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const ipv4Match = IPV4_PATTERN.exec(trimmed);
  if (ipv4Match) {
    const octets = [ipv4Match[1], ipv4Match[2], ipv4Match[3], ipv4Match[4]].map(Number);
    if (octets.every((n) => n >= 0 && n <= 255)) return null;
    return "Invalid IP address — each octet must be 0–255";
  }

  if (HOSTNAME_PATTERN.test(trimmed) && trimmed.length <= 253) return null;

  return "Enter a valid hostname or IP address";
};
