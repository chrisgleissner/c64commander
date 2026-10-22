/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Where the FTP clients of this app put the reply code they received, as far as any of them does:
 * the web bridge and a plain rejection start the message with it (after an 'FTP list failed: ' prefix on the
 * bridge), iOS says 'FTP command failed (nnn)' and Android says 'refused (nnn)' and also rejects with the code
 * FTP_REPLY_nnn. A number anywhere else in a message is a path, a port, an address or a duration.
 */
const REPLY_CODE_POSITIONS = [
  /^(?:FTP [a-z ]+ failed: )?(\d{3})(?:[ -]|$)/i,
  /FTP command failed \((\d{3})\)/i,
  / refused \((\d{3})\)/i,
];

/** The reply code the device answered with, or undefined when the failure says nothing about a reply. */
export const ftpReplyCodeOf = (error: unknown): number | undefined => {
  const fields = error as { cause?: unknown; code?: unknown } | null;
  if (fields?.cause !== undefined && fields.cause !== null) return ftpReplyCodeOf(fields.cause);
  const nativeCode = typeof fields?.code === "string" ? /^FTP_REPLY_(\d{3})$/.exec(fields.code) : null;
  if (nativeCode) return Number(nativeCode[1]);
  const message = error instanceof Error ? error.message : String(error);
  for (const position of REPLY_CODE_POSITIONS) {
    const found = position.exec(message);
    if (found) return Number(found[1]);
  }
  return undefined;
};

/** The device answered with an error reply. 421 is the server closing the connection, which is not an answer. */
export const isFtpErrorReply = (error: unknown) => {
  const code = ftpReplyCodeOf(error);
  return code !== undefined && code >= 400 && code <= 599 && code !== 421;
};
