/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Failures to turn a host name into an address, as each platform words them. The letters dns are matched only
 * as the word before a resolver noun, never inside a host name (c64.ddns.net, dns-server.local), a path
 * (/Usb0/dns_error.prg) or a device setting (Static DNS: error 400, "DNS Server": HTTP 500).
 *
 * A phone that has lost its network gets the same wording as one that was given a mistyped name, so every
 * name resolution failure counts as a connectivity failure that may pass.
 */
const DNS_FAILURE_PATTERN = new RegExp(
  [
    String.raw`\(dns\)`,
    String.raw`(?<![\w./-])dns (?:lookup|resolution|resolve|query)\b`,
    "dns server failure",
    "dns_probe_finished",
    "err_name_not_resolved",
    "temporary failure in name resolution",
    "eai_again",
    "name or service not known",
    "unknownhostexception",
    "unknown host",
    "unable to resolve host",
    "cannot resolve host",
    "no such host",
    "enotfound",
    "ename_not_found",
    "getaddrinfo",
    "nodename nor servname",
    "server with the specified hostname could not be found",
  ].join("|"),
  "i",
);

export const isDnsFailureMessage = (message: string): boolean => DNS_FAILURE_PATTERN.test(message);
