/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The advertised JSON Schema is derived from the zod schema, so this covers the
 * derivation: every construct a tool schema may use, and a loud failure for every
 * construct it may not.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "../src/tools/jsonSchema.js";

describe("toJsonSchema", () => {
  it("derives a strict object with its required keys and closes it", () => {
    const schema = z.object({ a: z.string(), b: z.boolean().optional() }).strict();
    expect(toJsonSchema(schema)).toEqual({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "boolean" } },
      required: ["a"],
      additionalProperties: false,
    });
  });

  it("refuses an object that is not strict, because the advertised schema could not close it", () => {
    expect(() => toJsonSchema(z.object({ a: z.string() }))).toThrow(/must be \.strict\(\)/);
    expect(() => toJsonSchema(z.object({ a: z.string() }).passthrough())).toThrow(/"passthrough"/);
  });

  it("carries a description through an optional wrapper, with the outer one winning", () => {
    expect(toJsonSchema(z.string().describe("inner").optional())).toEqual({ type: "string", description: "inner" });
    expect(toJsonSchema(z.string().describe("inner").optional().describe("outer"))).toEqual({
      type: "string",
      description: "outer",
    });
  });

  it("advertises a default and a nullable alternative", () => {
    expect(toJsonSchema(z.number().default(5))).toEqual({ type: "number", default: 5 });
    expect(toJsonSchema(z.string().nullable())).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  });

  it("derives the unrefined schema from a refinement, which has nothing to introspect", () => {
    const schema = z
      .object({ a: z.string().optional() })
      .strict()
      .refine((value) => Object.keys(value).length > 0);
    expect(toJsonSchema(schema)).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
      required: [],
      additionalProperties: false,
    });
  });

  it("advertises string constraints", () => {
    expect(toJsonSchema(z.string().min(1))).toEqual({ type: "string", minLength: 1 });
    expect(toJsonSchema(z.string().max(9))).toEqual({ type: "string", maxLength: 9 });
    expect(toJsonSchema(z.string().regex(/^\d+x\d+$/))).toEqual({ type: "string", pattern: "^\\d+x\\d+$" });
    expect(() => toJsonSchema(z.string().email())).toThrow(/string check "email"/);
  });

  it("advertises number constraints, and integer as its own type", () => {
    expect(toJsonSchema(z.number())).toEqual({ type: "number" });
    expect(toJsonSchema(z.number().int().positive())).toEqual({ type: "integer", exclusiveMinimum: 0 });
    expect(toJsonSchema(z.number().int().nonnegative())).toEqual({ type: "integer", minimum: 0 });
    expect(toJsonSchema(z.number().int().min(1).max(65535))).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 65535,
    });
    expect(toJsonSchema(z.number().lt(10))).toEqual({ type: "number", exclusiveMaximum: 10 });
    expect(() => toJsonSchema(z.number().finite())).toThrow(/number check "finite"/);
  });

  it("advertises arrays, unions, enums and literals", () => {
    expect(toJsonSchema(z.array(z.string()).min(1).max(4))).toEqual({
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 4,
    });
    expect(toJsonSchema(z.union([z.number().int(), z.string().min(1)]))).toEqual({
      anyOf: [{ type: "integer" }, { type: "string", minLength: 1 }],
    });
    expect(toJsonSchema(z.enum(["adb", "ssh"]))).toEqual({ type: "string", enum: ["adb", "ssh"] });
    expect(toJsonSchema(z.literal(true))).toEqual({ type: "boolean", enum: [true] });
    expect(toJsonSchema(z.literal("a"))).toEqual({ type: "string", enum: ["a"] });
    expect(toJsonSchema(z.literal(7))).toEqual({ type: "number", enum: [7] });
    expect(() => toJsonSchema(z.literal(null))).toThrow(/string, number and boolean literals/);
  });

  it("refuses a construct it cannot advertise rather than understating the validator", () => {
    expect(() => toJsonSchema(z.date())).toThrow(/cannot derive a JSON Schema from ZodDate/);
  });
});
