/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export function serializeTraceValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return { type: "Buffer", base64: value.toString("base64") };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      type: value.constructor.name,
      base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64"),
    };
  }
  if (value instanceof ArrayBuffer) {
    return { type: "ArrayBuffer", base64: Buffer.from(value).toString("base64") };
  }
  if (typeof value === "object") {
    if (typeof (value as { getHeaders?: () => unknown }).getHeaders === "function") {
      return {
        type: "FormData",
        headers: serializeTraceValue((value as { getHeaders: () => unknown }).getHeaders()),
      };
    }
    return value;
  }
  return value;
}

export function sanitizeTraceHeaders(
  headers: Record<string, string | string[] | undefined> | Record<string, unknown> | undefined,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  if (!headers) {
    return sanitized;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "x-password") {
      continue;
    }
    if (Array.isArray(value)) {
      sanitized[key] = value.join(", ");
      continue;
    }
    if (value === undefined) {
      continue;
    }
    sanitized[key] = String(value);
  }
  return sanitized;
}

export function maskFtpCommand(command: string): string {
  if (command.toUpperCase().startsWith("PASS ")) {
    return "PASS ***";
  }
  return command;
}
