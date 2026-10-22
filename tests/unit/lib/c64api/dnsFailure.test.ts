/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { isDnsFailureMessage } from "@/lib/c64api/dnsFailure";

const RESOLVER_WORDINGS = [
  "Host unreachable (DNS)",
  "DNS lookup failed",
  "DNS resolution error for c64u",
  "DNS query failed",
  "DNS server failure",
  "net::ERR_NAME_NOT_RESOLVED",
  "DNS_PROBE_FINISHED_NXDOMAIN",
  "getaddrinfo EAI_AGAIN c64u",
  "Temporary failure in name resolution",
  "Name or service not known",
  "java.net.UnknownHostException: c64u",
  'Unable to resolve host "c64u": No address associated with hostname',
  "Cannot resolve host c64u",
  "dial tcp: lookup c64u: no such host",
  "getaddrinfo ENOTFOUND c64u",
  "nodename nor servname provided, or not known",
  "A server with the specified hostname could not be found.",
];

const NOT_RESOLVER = [
  "We couldn’t reach “c64.ddns.net”.",
  "Failed to fetch http://dns-server.local/v1/info",
  "Failed to fetch http://dns-probe.lan/v1/info",
  "550 /Usb0/dns_error.prg: not found",
  "Failed to set Static DNS: error 400",
  'config item "DNS Server": HTTP 500',
  "Primary DNS failed",
  "Cannot resolve /Usb0/Games/loader.prg",
  "Request timed out",
];

describe("isDnsFailureMessage", () => {
  it.each(RESOLVER_WORDINGS)("recognises %s", (message) => {
    expect(isDnsFailureMessage(message)).toBe(true);
  });

  it.each(NOT_RESOLVER)("does not read %s as a name resolution failure", (message) => {
    expect(isDnsFailureMessage(message)).toBe(false);
  });
});
