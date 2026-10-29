/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { JsonSchema } from "./types.js";

interface ZodCheckDef {
  readonly check: string;
  readonly value?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly inclusive?: boolean;
  readonly format?: string;
  readonly pattern?: RegExp;
}

interface ZodCheck {
  readonly _zod: { readonly def: ZodCheckDef };
}

/**
 * Only the fields of zod 4's schema definitions that this walker reads. zod always
 * populates the field belonging to the node's own type, so a node is read through
 * the fields its `type` names. A fallback here would be an untestable branch
 * standing in for a zod release that renamed its internals, which would break
 * loudly at the first tool schema anyway.
 */
interface ZodDef {
  readonly type: string;
  readonly innerType?: unknown;
  readonly defaultValue?: unknown;
  readonly options?: readonly unknown[];
  readonly entries?: Readonly<Record<string, string | number>>;
  readonly values?: readonly unknown[];
  readonly element?: unknown;
  readonly shape?: Readonly<Record<string, unknown>>;
  readonly catchall?: { readonly def: { readonly type: string } };
  readonly checks?: readonly ZodCheck[];
}

interface ZodSchema {
  readonly def: ZodDef;
  readonly description?: string;
  isOptional(): boolean;
}

/**
 * The zod schema is the single source: the advertised JSON Schema is derived from
 * it, so a constraint cannot be enforced at execute time without also being
 * advertised. An unsupported construct throws at import rather than emitting a
 * schema that understates what the validator will reject.
 */
export function toJsonSchema(schema: unknown): JsonSchema {
  const zodSchema = schema as ZodSchema;
  const body = convert(zodSchema);
  return zodSchema.description === undefined ? body : { ...body, description: zodSchema.description };
}

function convert(schema: ZodSchema): JsonSchema {
  const def = schema.def;
  switch (def.type) {
    case "optional":
      return toJsonSchema(def.innerType);
    case "default":
      return { ...toJsonSchema(def.innerType), default: def.defaultValue };
    case "nullable":
      return { anyOf: [toJsonSchema(def.innerType), { type: "null" }] };
    case "object":
      return objectSchema(schema);
    case "array":
      return arraySchema(schema);
    case "union":
      return { anyOf: (def.options ?? []).map((option) => toJsonSchema(option)) };
    case "enum":
      return { type: "string", enum: Object.values(def.entries ?? {}) };
    case "literal":
      return literalSchema(def.values ?? []);
    case "boolean":
      return { type: "boolean" };
    case "number":
      return numberSchema(def.checks ?? []);
    case "string":
      return stringSchema(def.checks ?? []);
    default:
      throw new Error(
        `toJsonSchema cannot derive a JSON Schema from zod type "${def.type}"; extend it before using that construct in a tool schema. Schema: ${String(schema)}`,
      );
  }
}

function unknownKeysMode(def: ZodDef): string {
  const catchall = def.catchall?.def.type;
  if (catchall === undefined) {
    return "strip";
  }
  if (catchall === "never") {
    return "strict";
  }
  if (catchall === "unknown" || catchall === "any") {
    return "passthrough";
  }
  return catchall;
}

function objectSchema(schema: ZodSchema): JsonSchema {
  const mode = unknownKeysMode(schema.def);
  if (mode !== "strict") {
    throw new Error(
      `A tool object schema must be .strict() so the advertised schema can close it to additional properties; this one is "${mode}".`,
    );
  }
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, child] of Object.entries(schema.def.shape ?? {})) {
    const childSchema = child as ZodSchema;
    properties[key] = toJsonSchema(childSchema);
    if (!childSchema.isOptional()) {
      required.push(key);
    }
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function arraySchema(schema: ZodSchema): JsonSchema {
  const items = toJsonSchema(schema.def.element);
  const advertised: Record<string, unknown> = { type: "array", items };
  for (const check of schema.def.checks ?? []) {
    const checkDef = check._zod.def;
    if (checkDef.check === "min_length") {
      advertised["minItems"] = checkDef.minimum;
    } else if (checkDef.check === "max_length") {
      advertised["maxItems"] = checkDef.maximum;
    } else {
      throw new Error(`toJsonSchema does not know how to advertise the array check "${checkDef.check}".`);
    }
  }
  return advertised as JsonSchema;
}

function literalSchema(values: readonly unknown[]): JsonSchema {
  if (values.length !== 1) {
    throw new Error(`toJsonSchema supports exactly one value per literal, not ${values.length}.`);
  }
  const [value] = values;
  const type = typeof value;
  if (type !== "string" && type !== "number" && type !== "boolean") {
    throw new Error(`toJsonSchema supports string, number and boolean literals, not ${type}.`);
  }
  return { type, enum: [value as string | number | boolean] };
}

function numberSchema(checks: readonly ZodCheck[]): JsonSchema {
  const checkDefs = checks.map((check) => check._zod.def);
  const schema: Record<string, unknown> = {
    type: checkDefs.some((check) => check.check === "number_format" && check.format === "safeint")
      ? "integer"
      : "number",
  };
  for (const check of checkDefs) {
    if (check.check === "number_format" && check.format === "safeint") {
      continue;
    }
    if (check.check === "greater_than") {
      schema[check.inclusive ? "minimum" : "exclusiveMinimum"] = check.value;
    } else if (check.check === "less_than") {
      schema[check.inclusive ? "maximum" : "exclusiveMaximum"] = check.value;
    } else {
      throw new Error(`toJsonSchema does not know how to advertise the number check "${check.check}".`);
    }
  }
  return schema as JsonSchema;
}

function stringSchema(checks: readonly ZodCheck[]): JsonSchema {
  const schema: Record<string, unknown> = { type: "string" };
  for (const check of checks) {
    const checkDef = check._zod.def;
    if (checkDef.check === "min_length") {
      schema["minLength"] = checkDef.minimum;
    } else if (checkDef.check === "max_length") {
      schema["maxLength"] = checkDef.maximum;
    } else if (checkDef.check === "string_format" && checkDef.format === "regex") {
      schema["pattern"] = checkDef.pattern?.source;
    } else {
      const label = checkDef.check === "string_format" ? checkDef.format : checkDef.check;
      throw new Error(`toJsonSchema does not know how to advertise the string check "${label}".`);
    }
  }
  return schema as JsonSchema;
}
