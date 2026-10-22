/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { isRefusedFtpListing } from "@/lib/ftp/ftpClient";
import { isDeviceAnswer, UnreadableFolderError } from "@/lib/sourceNavigation/connectionFailure";

const withCause = (message: string, cause: Error) => new Error(message, { cause });

const answers: Array<[string, unknown]> = [
  ["web: refusal from the bridge", new Error("FTP list failed: 550 No such file or directory")],
  ["web: refusal naming a folder called Timeouts", new Error("FTP list failed: 550 /USB0/Timeouts: not found")],
  ["web: 450", new Error("FTP list failed: 450 Requested file action not taken")],
  ["web: 530 login", new Error("FTP list failed: 530 Login incorrect")],
  ["plain rejection", new Error("451 Requested action aborted")],
  ["plain string rejection", "451 Requested action aborted"],
  ["ios: 550", new Error("FTP command failed (550)")],
  ["ios: 450", new Error("FTP command failed (450)")],
  ["ios: 451", new Error("FTP command failed (451)")],
  ["android: refused", new Error("FTP LIST /Usb0/Demos refused (550): 550 No such directory")],
  ["android: refused folder named Timeout", new Error("FTP LIST /Usb0/Timeout refused (450): 450 Busy")],
  ["android: code on the rejection", Object.assign(new Error("anything at all"), { code: "FTP_REPLY_451" })],
  ["unreadable folder", new UnreadableFolderError("/USB0/My Timeout Folder")],
  [
    "readability check failed with a refusal, folder named Top 450 Games",
    withCause(
      "Could not check whether /USB0/Top 450 Games can be read: FTP command failed (530)",
      new Error("FTP command failed (530)"),
    ),
  ],
  [
    "readability check failed with 501",
    withCause(
      "Could not check whether /USB0/Games can be read: FTP list failed: 501 Syntax error",
      new Error("FTP list failed: 501 Syntax error"),
    ),
  ],
];

const notAnswers: Array<[string, unknown]> = [
  ["web: control socket timeout", new Error("FTP list failed: Timeout (control socket)")],
  ["web: host unreachable", new Error("FTP list failed: connect EHOSTUNREACH 192.168.1.13:21 (control socket)")],
  [
    "web: refused connection, port in the reply range",
    new Error("FTP list failed: connect ECONNREFUSED 192.168.1.13:550"),
  ],
  ["web: timeout, IPv6 address", new Error("FTP list failed: connect ETIMEDOUT ::1:450")],
  ["web: reset", new Error("FTP list failed: read ECONNRESET")],
  ["web: FIN", new Error("FTP list failed: Server sent FIN packet unexpectedly, closing connection.")],
  ["web: 421", new Error("FTP list failed: 421 Too many FTP connections")],
  ["web: 421 closing", new Error("FTP list failed: 421 Service not available, closing control connection")],
  ["web: bridge statuses", new Error("FTP bridge error: HTTP 404")],
  ["web: bridge 500", new Error("FTP bridge error: HTTP 500")],
  ["web: name not found", new Error("FTP list failed: getaddrinfo ENOTFOUND u64")],
  ["ios: 421", new Error("FTP command failed (421)")],
  ["ios: stream", new Error("FTP stream read failed")],
  ["android: timeout", new Error("FTP listDirectory timed out after connect 450ms / transfer 5000ms")],
  ["android: closed", new Error("Connection closed without indication.")],
  ["android: 421", new Error("FTP response 421 received.  Server closed connection.")],
  ["android: host name", new Error('Unable to resolve host "c64u": No address associated with hostname')],
  ["circuit open", new Error("Device circuit open")],
  ["a duration in the reply range", new Error("FTP listDirectory failed after 450 ms")],
  ["a number in a folder name", new Error("No entries in /USB0/550/Demos")],
  ["an unrecognized failure", new Error("Something unexpected happened")],
  [
    "readability check failed with a timeout, folder named Top 450 Games",
    withCause(
      "Could not check whether /USB0/Top 450 Games can be read: Timeout (control socket)",
      new Error("FTP list failed: Timeout (control socket)"),
    ),
  ],
  [
    "the same message without its cause",
    new Error("Could not check whether /USB0/Games can be read: FTP list failed: 501 Syntax error"),
  ],
];

describe("isDeviceAnswer", () => {
  it.each(answers)("takes %s as an answer from the device", (_form, error) => {
    expect(isDeviceAnswer(error)).toBe(true);
  });

  it.each(notAnswers)("does not take %s for an answer from the device", (_form, error) => {
    expect(isDeviceAnswer(error)).toBe(false);
  });
});

describe("isRefusedFtpListing", () => {
  it.each(["450", "451", "550"])("recognizes a %s reply of each client", (code) => {
    expect(isRefusedFtpListing(new Error(`FTP list failed: ${code} refused`))).toBe(true);
    expect(isRefusedFtpListing(new Error(`FTP command failed (${code})`))).toBe(true);
    expect(isRefusedFtpListing(new Error(`FTP LIST /Usb0/Demos refused (${code}): ${code} no`))).toBe(true);
  });

  it("does not read a port, a duration or a folder name as a refusal", () => {
    expect(isRefusedFtpListing(new Error("connect ETIMEDOUT 192.168.1.13:550"))).toBe(false);
    expect(isRefusedFtpListing(new Error("FTP listDirectory timed out after connect 450ms"))).toBe(false);
    expect(isRefusedFtpListing(new Error("Could not read /USB0/Top 450 Games"))).toBe(false);
  });

  it("does not take another error reply for a refusal to open a folder", () => {
    expect(isRefusedFtpListing(new Error("FTP list failed: 530 Login incorrect"))).toBe(false);
  });
});
