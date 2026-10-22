/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isRefusedFtpListing } from "@/lib/ftp/ftpClient";
import { isTransientConnectivityFailure } from "@/lib/uiErrors";

const LOST_CONNECTION_PATTERN = new RegExp(
  [
    "timed out",
    "timeout",
    "unable to resolve host",
    "connection (?:reset|abort|refused|closed|lost)",
    "software caused",
    "no route to host",
    "network is unreachable",
    "broken pipe",
    "\\be(?:netunreach|hostunreach|connrefused|connreset|connaborted|timedout|pipe|notfound)\\b",
    "getaddrinfo",
    "server sent fin",
    "socket closed due to transmission error",
    "response 421",
    "server closed connection",
    "kcferrordomaincfnetwork",
  ].join("|"),
  "i",
);

/** Paths in a message name folders the user chose ("Timeouts", "NoTimeout"); they say nothing about the link. */
const withoutPaths = (message: string) => message.replace(/\/\S*/g, " ");

/** What a failed device listing says when the device or the network is gone, in the words of each FTP client. */
export const isConnectionFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const text = withoutPaths(message);
  if (isRefusedFtpListing(text)) return false;
  return LOST_CONNECTION_PATTERN.test(text) || isTransientConnectivityFailure(text);
};
