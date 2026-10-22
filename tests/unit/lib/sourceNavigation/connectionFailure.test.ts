/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  classifyListingFailure,
  isTemporaryNameFailure,
  UnreadableFolderError,
  type ListingFailureKind,
} from "@/lib/sourceNavigation/connectionFailure";

const lost = [
  "FTP list failed: Timeout (control socket)",
  "FTP list failed: connect EHOSTUNREACH 192.168.1.13:21 (control socket)",
  "FTP list failed: connect ECONNREFUSED 192.168.1.13:21 (control socket)",
  "FTP list failed: read ECONNRESET",
  "FTP list failed: connect ETIMEDOUT 192.168.1.13:21",
  "FTP list failed: Server sent FIN packet unexpectedly, closing connection.",
  "FTP list failed: Socket closed due to transmission error (data socket)",
  "FTP list failed: 421 Too many FTP connections",
  "FTP list failed: 421 Service not available, closing control connection",
  "FTP command failed (421)",
  "FTP response 421 received.  Server closed connection.",
  "FTP bridge error: HTTP 502",
  "FTP stream read failed",
  "FTP data read failed",
  "Device circuit open",
  "The operation couldn’t be completed. Connection refused",
  "The operation could not be completed. (kCFErrorDomainCFNetwork error 2.)",
  "POSIX error: Host is down",
  "POSIX error: Socket is not connected",
  "Connection closed without indication.",
  "FTP listDirectory timed out after connect 450ms / transfer 5000ms",
  "FTP listDirectory timed out after connect 1500ms / transfer 5000ms",
];

const nameFailure = [
  "FTP list failed: getaddrinfo ENOTFOUND u64",
  'Unable to resolve host "c64u": No address associated with hostname',
  "Name or service not known",
  "java.net.UnknownHostException: c64u",
  "dial tcp: lookup c64u: no such host",
  "nodename nor servname provided, or not known",
  "Cannot resolve host c64u",
  "Host unreachable (DNS)",
  "getaddrinfo EAI_AGAIN c64u",
];

const deviceReply = [
  "550 Cannot open directory",
  "FTP list failed: 550 /USB0/Demos: No such file or directory",
  "FTP LIST /USB0/Demos/Timeouts refused (550): no such folder",
  "FTP LIST /USB0/Demos/Timeout refused (450): busy",
  "451 Requested action aborted",
  "550 /Usb0/dns_error.prg: not found",
  new UnreadableFolderError("/USB0/My Timeout Folder"),
  new UnreadableFolderError("/"),
];

const unknown = [
  "Something unexpected happened",
  "Cannot read properties of undefined (reading 'entries')",
  "No entries in /USB0/421/Demos",
  "No entries in /USB0/550/Demos",
];

const table: Array<[ListingFailureKind, unknown]> = [
  ...lost.map((message): [ListingFailureKind, unknown] => ["lost", new Error(message)]),
  ...nameFailure.map((message): [ListingFailureKind, unknown] => ["nameFailure", new Error(message)]),
  ...deviceReply.map((entry): [ListingFailureKind, unknown] => [
    "deviceReply",
    typeof entry === "string" ? new Error(entry) : entry,
  ]),
  ...unknown.map((message): [ListingFailureKind, unknown] => ["unknown", new Error(message)]),
];

describe("classifyListingFailure", () => {
  it.each(table)("reads a failure as %s: %s", (kind, error) => {
    expect(classifyListingFailure(error)).toBe(kind);
  });

  it("reads a plain string rejection the same way as an error with that message", () => {
    expect(classifyListingFailure("451 Requested action aborted")).toBe("deviceReply");
    expect(classifyListingFailure("connection reset")).toBe("lost");
  });

  it("goes by the kind of an unreadable folder error, whatever the folder is called", () => {
    expect(classifyListingFailure(new UnreadableFolderError("/USB0/Connection reset/timed out"))).toBe("deviceReply");
  });
});

describe("isTemporaryNameFailure", () => {
  it("is true only where the resolver said to try again", () => {
    expect(isTemporaryNameFailure(new Error("getaddrinfo EAI_AGAIN c64u"))).toBe(true);
    expect(isTemporaryNameFailure(new Error("getaddrinfo ENOTFOUND c64u"))).toBe(false);
  });
});
