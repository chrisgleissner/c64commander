/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { isConnectionFailure } from "@/lib/sourceNavigation/connectionFailure";

describe("isConnectionFailure", () => {
  it.each([
    ["web: control socket timeout", "FTP list failed: Timeout (control socket)"],
    ["web: host unreachable", "FTP list failed: connect EHOSTUNREACH 192.168.1.13:21 (control socket)"],
    ["web: refused", "FTP list failed: connect ECONNREFUSED 192.168.1.13:21 (control socket)"],
    ["web: name not found", "FTP list failed: getaddrinfo ENOTFOUND u64"],
    ["web: reset", "FTP list failed: read ECONNRESET"],
    ["web: connect timed out", "FTP list failed: connect ETIMEDOUT 192.168.1.13:21"],
    ["web: FIN", "FTP list failed: Server sent FIN packet unexpectedly, closing connection."],
    ["web: transmission error", "FTP list failed: Socket closed due to transmission error (data socket)"],
    ["ios: unresolvable host", "The operation could not be completed. (kCFErrorDomainCFNetwork error 2.)"],
    ["ios: refused", "The operation couldn’t be completed. Connection refused"],
    ["android: closed", "Connection closed without indication."],
    ["android: 421", "FTP response 421 received.  Server closed connection."],
    ["android: timeout", "FTP listDirectory timed out after connect 1500ms / transfer 5000ms"],
  ])("recognizes %s", (_form, message) => {
    expect(isConnectionFailure(new Error(message))).toBe(true);
  });

  it.each([
    ["a refused folder named Timeouts", "FTP LIST /USB0/Demos/Timeouts refused (550): no such folder"],
    ["a refused folder named Timeout", "FTP LIST /USB0/Demos/Timeout refused (550): no such folder"],
    ["a read of a folder named NoTimeout", "The C64 could not read /USB0/NoTimeout/game.sid"],
    ["a plain server refusal", "550 Cannot open directory"],
  ])("does not take %s for a lost connection", (_form, message) => {
    expect(isConnectionFailure(new Error(message))).toBe(false);
  });
});
