/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { redactErrorMessage, redactHeaders, redactPayload, REDACTION } from "@/lib/tracing/redaction";
import { redactTreeUri } from "@/lib/native/safUtils";

vi.mock("@/lib/native/safUtils", () => ({
  redactTreeUri: vi.fn(() => "REDACTED_URI"),
}));

describe("redaction", () => {
  it("redacts sensitive headers and URI values", () => {
    const input = {
      Authorization: "Bearer secret-token",
      "X-Password": "hunter2",
      "X-Token": ["token-a", "token-b"],
      "Content-Type": "application/json",
      "X-Path": "content://com.example/document/123",
    };

    const redacted = redactHeaders(input);

    expect(redacted.Authorization).toBe(`Bearer sec${REDACTION.PARTIAL_SUFFIX}`);
    expect(redacted["X-Password"]).toBe(`hun${REDACTION.PARTIAL_SUFFIX}`);
    expect(redacted["X-Token"]).toEqual([`tok${REDACTION.PARTIAL_SUFFIX}`, `tok${REDACTION.PARTIAL_SUFFIX}`]);
    expect(redacted["Content-Type"]).toBe("application/json");
    expect(redacted["X-Path"]).toBe("REDACTED_URI");
  });

  it("preserves basic auth scheme while redacting only the credential prefix", () => {
    const redacted = redactHeaders({ Authorization: "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==" });

    expect(redacted.Authorization).toBe(`Basic QWx${REDACTION.PARTIAL_SUFFIX}`);
  });

  it("redacts nested payloads and arrays", () => {
    const payload = {
      token: "abc123",
      nested: {
        auth: "secret",
        uri: "file:///storage/emulated/0/Download/test.sid",
        list: [{ password: "pw" }, "content://com.example/tree/456"],
      },
    };

    const redacted = redactPayload(payload);

    expect(redacted).toEqual({
      token: `abc${REDACTION.PARTIAL_SUFFIX}`,
      nested: {
        auth: `sec${REDACTION.PARTIAL_SUFFIX}`,
        uri: "REDACTED_URI",
        list: [{ password: `pw${REDACTION.PARTIAL_SUFFIX}` }, "REDACTED_URI"],
      },
    });
  });

  it("redacts sensitive arrays while preserving array shape", () => {
    expect(redactPayload({ tokens: ["alpha", "bravo"] })).toEqual({
      tokens: [`alp${REDACTION.PARTIAL_SUFFIX}`, `bra${REDACTION.PARTIAL_SUFFIX}`],
    });
  });

  it("redacts URI-only error messages", () => {
    const message = "content://com.example/tree/789";
    expect(redactErrorMessage(message)).toBe("REDACTED_URI");
  });

  it("returns whitespace-only string unchanged from redactUri (line 24 TRUE)", () => {
    expect(redactErrorMessage("   ")).toBe("   ");
  });

  it("falls back to REDACTED when redactTreeUri returns null (line 26)", () => {
    vi.mocked(redactTreeUri).mockReturnValueOnce(null);
    expect(redactErrorMessage("content://com.example/doc")).toBe(REDACTION.REDACTED);
  });

  it("skips undefined header values (line 48)", () => {
    const result = redactHeaders({ "X-Meta": undefined });
    expect(result["X-Meta"]).toBeUndefined();
  });

  it("redacts array values for non-sensitive header keys (line 53)", () => {
    vi.mocked(redactTreeUri).mockImplementation((v: string) => `REDACTED:${v}`);
    const result = redactHeaders({ "X-Paths": ["file:///a", "file:///b"] });
    expect(result["X-Paths"]).toEqual(["REDACTED:file:///a", "REDACTED:file:///b"]);
    vi.mocked(redactTreeUri).mockImplementation(() => "REDACTED_URI");
  });

  it("passes non-string array entries through unchanged (line 52 ternary FALSE)", () => {
    // entry is not a string → `typeof entry === "string"` FALSE → returns entry as-is
    const result = redactHeaders({ "X-Paths": ["/path", 42 as unknown as string] });
    expect((result["X-Paths"] as unknown[])[1]).toBe(42);
  });

  it("passes non-string, non-array header values through unchanged (line 55 ternary FALSE)", () => {
    // value is not string and not array → `typeof value === "string"` FALSE → returns value as-is
    const result = redactHeaders({ "X-Custom": 42 as unknown as string });
    expect(result["X-Custom"]).toBe(42);
  });
});
