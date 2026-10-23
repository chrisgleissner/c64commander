/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { isDnsFailure, isNetworkFailureMessage } from "@/lib/c64api/requestFailureMessage";
import { normalizeTransportError } from "@/lib/c64api/transportErrors";
import { isOriginConnectivityFailure } from "@/lib/savedDevices/deviceBoundOrigin";
import { classifyError } from "@/lib/tracing/failureTaxonomy";
import { isTransientConnectivityFailure } from "@/lib/uiErrors";

/**
 * Every classifier that used to match the letters dns anywhere, as it was before the shared resolver module.
 * A message that one of them now classifies differently is a deliberate change and is listed below.
 */
const OLD = {
  transient: (m: string) =>
    /host unreachable|did not answer within|service unavailable|http 503|failed to fetch|failed to connect|net::err|request timed out|networkerror|dns|device circuit open|device circuit probe already in flight|device not ready for (?:requests|ftp|telnet)|device not connected/.test(
      m.toLowerCase(),
    ),
  requestDns: (m: string) => /unknown host|enotfound|ename_not_found|dns|unable to resolve host/i.test(m),
  requestNetwork: (m: string) =>
    /failed to fetch|networkerror|network request failed|unknown host|enotfound|ename_not_found|dns|unable to resolve host/i.test(
      m,
    ),
  taxonomy: (m: string) => {
    if (/timed out|timeout/i.test(m)) return "network-transient";
    if (!/failed to fetch|networkerror|network request failed|unknown host|enotfound|dns|offline|econn|socket/i.test(m))
      return "other";
    return /unknown host|enotfound|dns|unreachable|ehostunreach|enetunreach/i.test(m)
      ? "network-unreachable"
      : "network-transient";
  },
  transportDns: (m: string) =>
    /(unknown host|enotfound|ename_not_found|getaddrinfo|dns lookup|cannot resolve|unable to resolve host|host unreachable \(dns\))/i.test(
      m.toLowerCase(),
    ),
  origin: (m: string) =>
    /host unreachable|service unavailable|http 503|failed to fetch|request timed out|networkerror|dns|timed out|connection reset|econnreset|econnrefused|connection refused/i.test(
      m,
    ),
};

const NEW = {
  transient: isTransientConnectivityFailure,
  requestDns: isDnsFailure,
  requestNetwork: isNetworkFailureMessage,
  taxonomy: (m: string) => {
    const failureClass = classifyError(new Error(m)).failureClass;
    return failureClass === "network-unreachable" || failureClass === "network-transient" ? failureClass : "other";
  },
  transportDns: (m: string) => normalizeTransportError(new Error(m)).class === "dns",
  origin: isOriginConnectivityFailure,
};

const CORPUS = [
  "Host unreachable (DNS)",
  "Host unreachable",
  "DNS lookup failed",
  "DNS resolution error for c64u",
  "DNS query failed",
  "net::ERR_NAME_NOT_RESOLVED",
  "DNS_PROBE_FINISHED_NXDOMAIN",
  "getaddrinfo ENOTFOUND c64u",
  "getaddrinfo EAI_AGAIN c64u",
  "Temporary failure in name resolution",
  "Name or service not known",
  "java.net.UnknownHostException: c64u",
  'Unable to resolve host "c64u": No address associated with hostname',
  "Unknown host c64u",
  "dial tcp: lookup c64u: no such host",
  "A server with the specified hostname could not be found.",
  "nodename nor servname provided, or not known",
  "Failed to fetch",
  "Request timed out",
  "HTTP 503",
  "Connection refused",
  "Device circuit open",
  "FTP login failed",
  "550 /Usb0/Music/tune.sid: not found",
  "We couldn’t reach “c64.ddns.net”.",
  "Failed to fetch http://dns-server.local/v1/info",
  "550 /Usb0/dns_error.prg: not found",
  "Failed to set Static DNS: error 400",
  'config item "DNS Server": HTTP 500',
  "Primary DNS failed",
  "Cannot resolve /Usb0/Games/loader.prg",
];

/** Resolver wordings that no classifier recognised before, or only some of them. */
const NEWLY_RECOGNISED = [
  "net::ERR_NAME_NOT_RESOLVED",
  "DNS_PROBE_FINISHED_NXDOMAIN",
  "getaddrinfo EAI_AGAIN c64u",
  "Temporary failure in name resolution",
  "Name or service not known",
  "java.net.UnknownHostException: c64u",
  'Unable to resolve host "c64u": No address associated with hostname',
  "dial tcp: lookup c64u: no such host",
  "A server with the specified hostname could not be found.",
  "nodename nor servname provided, or not known",
  "Unknown host c64u",
  "getaddrinfo ENOTFOUND c64u",
  "DNS query failed",
  "DNS resolution error for c64u",
];

/** Messages that contained the letters dns without being a resolver failure. */
const NO_LONGER_MATCHED = [
  "We couldn’t reach “c64.ddns.net”.",
  "Failed to fetch http://dns-server.local/v1/info",
  "550 /Usb0/dns_error.prg: not found",
  "Failed to set Static DNS: error 400",
  'config item "DNS Server": HTTP 500',
  "Primary DNS failed",
  "Cannot resolve /Usb0/Games/loader.prg",
];

const changedMessages = () => {
  const changed = new Set<string>();
  for (const [name, oldClassifier] of Object.entries(OLD)) {
    const newClassifier = NEW[name as keyof typeof NEW] as (m: string) => unknown;
    for (const message of CORPUS) {
      if ((oldClassifier as (m: string) => unknown)(message) !== newClassifier(message)) changed.add(message);
    }
  }
  return changed;
};

describe("name resolution classification against the behaviour before the shared module", () => {
  it("changes only the messages that are listed as newly recognised or no longer matched", () => {
    const allowed = new Set([...NEWLY_RECOGNISED, ...NO_LONGER_MATCHED]);
    expect([...changedMessages()].filter((message) => !allowed.has(message))).toEqual([]);
  });

  it("lists no message that every classifier still treats the same", () => {
    const changed = changedMessages();
    expect([...NEWLY_RECOGNISED, ...NO_LONGER_MATCHED].filter((message) => !changed.has(message))).toEqual([]);
  });

  it("keeps every resolver wording a connectivity failure for the transient check", () => {
    for (const message of NEWLY_RECOGNISED) expect(NEW.transient(message)).toBe(true);
  });
});
