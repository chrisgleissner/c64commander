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
 * - nameFailure: the device's name could not be resolved. Treated like lost, and not asked again unless the
 *   resolver said the failure is temporary.
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

/** A three-digit reply code that is not part of a path, a longer word or a duration. */
const replyCode = (code: string) => new RegExp(`(?<![\\w/.-])${code}(?![\\w/.-]|\\s*ms\\b)`);
const FTP_421 = replyCode("421");
const BRIDGE_UNAVAILABLE = /ftp bridge error: http 50[234]/i;
const FTP_REPLY_REFUSING = replyCode("[45]\\d\\d");

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
  const message = error instanceof Error ? error.message : String(error);
  if (FTP_421.test(message) || BRIDGE_UNAVAILABLE.test(message)) return "lost";
  if (FTP_REPLY_REFUSING.test(message)) return "deviceReply";
  if (isDnsFailureMessage(message)) return "nameFailure";
  if (LOST_CONNECTION_PATTERN.test(message) || isTransientConnectivityFailure(message)) return "lost";
  return "unknown";
};

/** A name failure that is worth asking again: the resolver said it was temporary. */
export const isTemporaryNameFailure = (error: unknown) =>
  isDnsFailureMessage(error instanceof Error ? error.message : String(error));
