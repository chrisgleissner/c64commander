/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PayloadPreview, TraceHeaders, TraceHeaderValue } from "@/lib/tracing/types";

export const TRACE_PAYLOAD_PREVIEW_BYTE_LIMIT = 64;

const getTextEncoder = () => {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder();
  }
  return {
    encode: (value: string) => Uint8Array.from(Buffer.from(value, "utf8")),
  };
};

const printableAscii = (value: number) => (value >= 32 && value <= 126 ? String.fromCharCode(value) : ".");

const appendHeaderValue = (headers: TraceHeaders, name: string, value: string) => {
  const existing = headers[name];
  if (existing === undefined) {
    headers[name] = value;
    return;
  }
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }
  headers[name] = [existing, value];
};

export const collectTraceHeaders = (headers?: HeadersInit | Headers | null): TraceHeaders => {
  if (!headers) return {};

  const collected: TraceHeaders = {};
  if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      appendHeaderValue(collected, key, value);
    });
    return collected;
  }

  if (typeof (headers as Headers).forEach === "function") {
    (headers as Headers).forEach((value, key) => {
      appendHeaderValue(collected, key, value);
    });
    return collected;
  }

  Object.entries(headers).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => appendHeaderValue(collected, key, String(item)));
      return;
    }
    if (value !== undefined) {
      appendHeaderValue(collected, key, String(value));
    }
  });
  return collected;
};

export const normalizeTraceHeaderValue = (value: unknown): TraceHeaderValue | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return [...value];
  }
  return null;
};

export const buildPayloadPreviewFromBytes = (bytes: Uint8Array | null | undefined): PayloadPreview | null => {
  if (!bytes || bytes.byteLength === 0) return null;
  const previewBytes = bytes.slice(0, TRACE_PAYLOAD_PREVIEW_BYTE_LIMIT);
  return {
    byteCount: bytes.byteLength,
    previewByteCount: previewBytes.byteLength,
    hex: Array.from(previewBytes)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(" "),
    ascii: Array.from(previewBytes).map(printableAscii).join(""),
    truncated: bytes.byteLength > previewBytes.byteLength,
  };
};

export const buildPayloadPreviewFromText = (value: string): PayloadPreview | null => {
  const bytes = getTextEncoder().encode(value);
  return buildPayloadPreviewFromBytes(bytes);
};

export const buildPayloadPreviewFromJson = (value: unknown): PayloadPreview | null => {
  try {
    return buildPayloadPreviewFromText(JSON.stringify(value));
  } catch {
    return null;
  }
};

export const decodeBase64ToBytes = (value: string): Uint8Array | null => {
  try {
    if (typeof atob === "function") {
      const decoded = atob(value);
      return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    }
    return Uint8Array.from(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
};

export const buildPayloadPreviewFromBase64 = (value: string): PayloadPreview | null => {
  const bytes = decodeBase64ToBytes(value);
  return buildPayloadPreviewFromBytes(bytes);
};
