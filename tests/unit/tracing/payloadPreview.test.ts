/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildPayloadPreviewFromBase64,
  buildPayloadPreviewFromBytes,
  buildPayloadPreviewFromJson,
  buildPayloadPreviewFromText,
  collectTraceHeaders,
  decodeBase64ToBytes,
  normalizeTraceHeaderValue,
  TRACE_PAYLOAD_PREVIEW_BYTE_LIMIT,
} from "@/lib/tracing/payloadPreview";

describe("payloadPreview", () => {
  describe("collectTraceHeaders", () => {
    it("returns empty object for null or undefined", () => {
      expect(collectTraceHeaders(null)).toEqual({});
      expect(collectTraceHeaders(undefined)).toEqual({});
    });

    it("collects headers from array of pairs", () => {
      const result = collectTraceHeaders([
        ["content-type", "application/json"],
        ["accept", "text/html"],
      ]);
      expect(result).toEqual({ "content-type": "application/json", accept: "text/html" });
    });

    it("accumulates duplicate headers from array into an array value", () => {
      const result = collectTraceHeaders([
        ["x-header", "a"],
        ["x-header", "b"],
        ["x-header", "c"],
      ]);
      expect(result["x-header"]).toEqual(["a", "b", "c"]);
    });

    it("collects headers from a Headers object via forEach", () => {
      const headers = new Headers({ "content-type": "application/json", accept: "text/plain" });
      const result = collectTraceHeaders(headers);
      expect(result["content-type"]).toBe("application/json");
      expect(result["accept"]).toBe("text/plain");
    });

    it("collects headers from a plain object", () => {
      const result = collectTraceHeaders({ authorization: "Bearer token", "x-custom": "value" });
      expect(result).toEqual({ authorization: "Bearer token", "x-custom": "value" });
    });

    it("skips undefined values in plain object form", () => {
      const headers: Record<string, string | string[] | undefined> = {
        present: "yes",
        missing: undefined,
      };
      const result = collectTraceHeaders(headers as HeadersInit);
      expect(result["present"]).toBe("yes");
      expect(result["missing"]).toBeUndefined();
    });

    it("expands array values in plain object form", () => {
      const headers: Record<string, string | string[]> = { "x-multi": ["a", "b"] };
      const result = collectTraceHeaders(headers as HeadersInit);
      expect(result["x-multi"]).toEqual(["a", "b"]);
    });
  });

  describe("normalizeTraceHeaderValue", () => {
    it("passes through string values", () => {
      expect(normalizeTraceHeaderValue("hello")).toBe("hello");
    });

    it("passes through string arrays", () => {
      expect(normalizeTraceHeaderValue(["a", "b"])).toEqual(["a", "b"]);
    });

    it("returns null for non-string non-array values", () => {
      expect(normalizeTraceHeaderValue(42)).toBeNull();
      expect(normalizeTraceHeaderValue(null)).toBeNull();
      expect(normalizeTraceHeaderValue({})).toBeNull();
    });

    it("returns null for mixed-type arrays", () => {
      expect(normalizeTraceHeaderValue(["a", 1])).toBeNull();
    });
  });

  describe("buildPayloadPreviewFromBytes", () => {
    it("returns null for null or undefined input", () => {
      expect(buildPayloadPreviewFromBytes(null)).toBeNull();
      expect(buildPayloadPreviewFromBytes(undefined)).toBeNull();
    });

    it("returns null for empty byte array", () => {
      expect(buildPayloadPreviewFromBytes(new Uint8Array(0))).toBeNull();
    });

    it("builds preview for small byte array without truncation", () => {
      const bytes = new Uint8Array([65, 66, 67]); // ABC
      const result = buildPayloadPreviewFromBytes(bytes);
      expect(result).not.toBeNull();
      expect(result!.byteCount).toBe(3);
      expect(result!.previewByteCount).toBe(3);
      expect(result!.hex).toBe("41 42 43");
      expect(result!.ascii).toBe("ABC");
      expect(result!.truncated).toBe(false);
    });

    it("sets truncated and limits hex/ascii to TRACE_PAYLOAD_PREVIEW_BYTE_LIMIT bytes", () => {
      const bytes = new Uint8Array(TRACE_PAYLOAD_PREVIEW_BYTE_LIMIT + 10).fill(65);
      const result = buildPayloadPreviewFromBytes(bytes);
      expect(result).not.toBeNull();
      expect(result!.truncated).toBe(true);
      expect(result!.byteCount).toBe(TRACE_PAYLOAD_PREVIEW_BYTE_LIMIT + 10);
      expect(result!.previewByteCount).toBe(TRACE_PAYLOAD_PREVIEW_BYTE_LIMIT);
    });

    it("replaces non-printable bytes with dots in ASCII preview", () => {
      const bytes = new Uint8Array([0x01, 0x41, 0x7f]); // SOH, A, DEL
      const result = buildPayloadPreviewFromBytes(bytes);
      expect(result!.ascii).toBe(".A.");
    });

    it("formats hex bytes with leading zeros", () => {
      const bytes = new Uint8Array([0x00, 0x0f, 0x10]);
      const result = buildPayloadPreviewFromBytes(bytes);
      expect(result!.hex).toBe("00 0f 10");
    });
  });

  describe("buildPayloadPreviewFromText", () => {
    it("encodes text and builds a preview", () => {
      const result = buildPayloadPreviewFromText("Hello");
      expect(result).not.toBeNull();
      expect(result!.ascii).toContain("Hello");
    });

    it("returns null for empty string", () => {
      expect(buildPayloadPreviewFromText("")).toBeNull();
    });
  });

  describe("buildPayloadPreviewFromJson", () => {
    it("serializes JSON and returns preview", () => {
      const result = buildPayloadPreviewFromJson({ key: "value" });
      expect(result).not.toBeNull();
      expect(result!.ascii).toContain("{");
    });

    it("returns null when JSON.stringify throws (circular reference)", () => {
      const circular: Record<string, unknown> = {};
      circular["self"] = circular;
      expect(buildPayloadPreviewFromJson(circular)).toBeNull();
    });
  });

  describe("decodeBase64ToBytes", () => {
    it("decodes valid base64 string to bytes", () => {
      const bytes = decodeBase64ToBytes(btoa("Hello"));
      expect(bytes).not.toBeNull();
      expect(Array.from(bytes!)).toEqual(Array.from(new TextEncoder().encode("Hello")));
    });

    it("returns null for invalid base64 input", () => {
      expect(decodeBase64ToBytes("!!!invalid!!!")).toBeNull();
    });
  });

  describe("buildPayloadPreviewFromBase64", () => {
    it("returns preview for valid base64", () => {
      const base64 = btoa("Hello World");
      const result = buildPayloadPreviewFromBase64(base64);
      expect(result).not.toBeNull();
      expect(result!.ascii).toContain("Hello World");
    });

    it("returns null for invalid base64", () => {
      expect(buildPayloadPreviewFromBase64("!!!invalid!!!")).toBeNull();
    });
  });
});
