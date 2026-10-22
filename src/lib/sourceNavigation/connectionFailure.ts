/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isDnsFailureMessage } from "@/lib/c64api/dnsFailure";
import { isTransientConnectivityFailure } from "@/lib/uiErrors";

/**
 * What a failed folder listing says about the device.
 * - lost: the link or the device is gone (timeout, refused, unreachable, reset, closed, FTP 421, open circuit).
 * - nameFailure: the device's name could not be resolved. A phone that lost its network is told the same, so it
 *   is treated like lost.
 * - deviceReply: the device answered, with a 4xx/5xx FTP reply other than 421 or an unreadable folder.
 * - unknown: anything else. Never taken as the device having answered.
 */
export type ListingFailureKind = "lost" | "nameFailure" | "deviceReply" | "unknown";

export const UNREADABLE_FOLDER_KIND = "unreadable-folder";

/** The device listed a folder as containing itself, which is how its FTP server shows an unreadable folder. */
export class UnreadableFolderError extends Error {
  readonly kind = UNREADABLE_FOLDER_KIND;

  constructor(path: string) {
    super(`The C64 could not read ${path}. Check that its storage is inserted and readable.`);
    this.name = "UnreadableFolderError";
  }
}

/**
 * Where an FTP client puts the reply code it received. A number elsewhere in a message is a path, a port, an
 * address or a duration and says nothing about the device.
 */
const REPLY_CODE_POSITIONS = [
  /^(?:FTP [a-z ]+ failed: )?(\d{3})(?:[ -]|$)/i,
  /FTP command failed \((\d{3})\)/i,
  /FTP response (\d{3}) received/i,
  / refused \((\d{3})\)/i,
  /\((\d{3})\)\.?$/,
];

const BRIDGE_HTTP_ERROR = /^FTP bridge error: HTTP \d+/i;

const replyCodeOf = (error: unknown, message: string): number | undefined => {
  const fields = error as { ftpCode?: unknown; code?: unknown } | null;
  if (typeof fields?.ftpCode === "number") return fields.ftpCode;
  const nativeCode = typeof fields?.code === "string" ? /^FTP_REPLY_(\d{3})$/.exec(fields.code) : null;
  if (nativeCode) return Number(nativeCode[1]);
  for (const position of REPLY_CODE_POSITIONS) {
    const found = position.exec(message);
    if (found) return Number(found[1]);
  }
  return undefined;
};

const LOST_CONNECTION_PATTERN = new RegExp(
  [
    "timed out",
    "timeout",
    "connection (?:reset|abort|refused|closed|lost)",
    "software caused",
    "no route to host",
    "network is unreachable",
    "host is down",
    "socket is not connected",
    "broken pipe",
    "\\be(?:netunreach|hostunreach|connrefused|connreset|connaborted|timedout|pipe)\\b",
    "server sent fin",
    "socket closed due to transmission error",
    "server closed connection",
    "kcferrordomaincfnetwork",
    "ftp (?:stream|data) read failed",
    "circuit (?:open|probe)",
  ].join("|"),
  "i",
);

const kindOf = (error: unknown) => (error as { kind?: unknown } | null)?.kind;

export const classifyListingFailure = (error: unknown): ListingFailureKind => {
  if (kindOf(error) === UNREADABLE_FOLDER_KIND) return "deviceReply";
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (cause !== undefined && cause !== null) return classifyListingFailure(cause);
  const message = error instanceof Error ? error.message : String(error);
  if (BRIDGE_HTTP_ERROR.test(message)) return "lost";
  const code = replyCodeOf(error, message);
  if (code === 421) return "lost";
  if (code !== undefined && code >= 400 && code <= 599) return "deviceReply";
  if (isDnsFailureMessage(message)) return "nameFailure";
  if (LOST_CONNECTION_PATTERN.test(message) || isTransientConnectivityFailure(message)) return "lost";
  return "unknown";
};
