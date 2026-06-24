/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { isSecretField, redactRecord, redactSecretLiterals, redactValue } from "../src/cta/redaction.js";

describe("isSecretField", () => {
  it("flags password-like field names in common casings and separators", () => {
    expect(isSecretField("password")).toBe(true);
    expect(isSecretField("device_password")).toBe(true);
    expect(isSecretField("api-key")).toBe(true);
    expect(isSecretField("authToken")).toBe(true);
    expect(isSecretField("refresh_token")).toBe(true);
  });

  it("does not flag ordinary field names", () => {
    expect(isSecretField("host")).toBe(false);
    expect(isSecretField("label")).toBe(false);
    expect(isSecretField("port")).toBe(false);
  });
});

describe("redactValue", () => {
  it("redacts string values of secret fields", () => {
    expect(redactValue("password", "supersecret")).toBe("[REDACTED]");
  });

  it("passes through non-secret field values", () => {
    expect(redactValue("host", "c64u")).toBe("c64u");
  });

  it("passes through non-string values unchanged", () => {
    expect(redactValue("password", 42)).toBe(42);
    expect(redactValue("password", null)).toBeNull();
  });
});

describe("redactSecretLiterals", () => {
  it("scrubs known secret literals wherever they appear in a string", () => {
    expect(redactSecretLiterals("connecting with pwd now", ["pwd"])).toBe("connecting with [REDACTED] now");
  });

  it("escapes regex-special characters in the secret", () => {
    expect(redactSecretLiterals("a.b*c", ["a.b*c"])).toBe("[REDACTED]");
  });

  it("ignores empty secret literals", () => {
    expect(redactSecretLiterals("unchanged", [""])).toBe("unchanged");
  });
});

describe("redactRecord", () => {
  it("redacts secret fields by name and scrubs secret literals nested in values", () => {
    const input = {
      route: "/settings",
      field: "host",
      device_password: "pwd",
      label: "saved device pwd entry",
      nested: { url: "ftp://user:pwd@c64u/root" },
    };
    const redacted = redactRecord(input, ["pwd"]);
    expect(redacted["device_password"]).toBe("[REDACTED]");
    expect(redacted["field"]).toBe("host");
    expect(redacted["label"]).toBe("saved device [REDACTED] entry");
    expect((redacted["nested"] as Record<string, unknown>)["url"]).toBe("ftp://user:[REDACTED]@c64u/root");
  });

  it("does not mutate the input record", () => {
    const input = { password: "secret" };
    redactRecord(input);
    expect(input["password"]).toBe("secret");
  });

  it("handles arrays of values", () => {
    const redacted = redactRecord({ items: ["pwd", "host"] }, ["pwd"]);
    expect(redacted["items"]).toEqual(["[REDACTED]", "host"]);
  });
});
