/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isFtpErrorReply } from "@/lib/ftp/ftpReply";

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
 * Whether a failed folder listing shows that the device answered: an error reply to the listing, or an unreadable
 * folder. Anything else (a timeout, a refused or reset connection, a name that did not resolve, a 421, an
 * unrecognized failure) is not an answer, and a run of such failures means the device cannot be reached.
 */
export const isDeviceAnswer = (error: unknown) =>
  (error as { kind?: unknown } | null)?.kind === UNREADABLE_FOLDER_KIND || isFtpErrorReply(error);
