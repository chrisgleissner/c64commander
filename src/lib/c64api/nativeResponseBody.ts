/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Statuses whose responses must not carry a body; the Response constructor throws
// ("Response with null body status cannot have body") if we pass one.
export const NULL_BODY_HTTP_STATUSES = new Set([101, 103, 204, 205, 304]);

// Decode the binary body CapacitorHttp returns for a responseType:"arraybuffer" request
// (base64 string on native; raw byte array as a defensive fallback). Mirrors the
// production-proven decoder in src/lib/archive/client.ts (kept inline to avoid coupling
// the device API client to the archive module). `atob` performs forgiving-base64 decode,
// so the line-wrapped Android Base64.DEFAULT output decodes correctly.
export const decodeNativeBase64ToArrayBuffer = (value: unknown): ArrayBuffer => {
  if (value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) return Uint8Array.from(value as number[]).buffer;
  if (typeof value === "string") {
    if (typeof atob === "function") {
      const decoded = atob(value);
      return Uint8Array.from(decoded, (char) => char.charCodeAt(0)).buffer;
    }
    return Uint8Array.from(Buffer.from(value, "base64")).buffer;
  }
  return new ArrayBuffer(0);
};
