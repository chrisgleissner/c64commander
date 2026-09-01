/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { JsonSchema } from "./types.js";

interface ZodCheck {
  readonly kind: string;
  readonly value?: number;
  readonly inclusive?: boolean;
  readonly regex?: RegExp;
}

/**
 * zod always populates the field belonging to the node's own type, so each is
 * read through a narrowing cast. A fallback here would be an untestable branch
 * standing in for a zod release that renamed its internals, which would break
 * loudly at the first tool schema anyway.
 */
interface ZodDef {
  readonly typeName: string;
  readonly description?: string;
  readonly minLength?: { value: number } | null;
  readonly maxLength?: { value: number } | null;
  readonly innerType?: unknown;
  readonly schema?: unknown;
  readonly type?: unknown;
  readonly value?: unknown;
  readonly unknownKeys?: string;
}

type Narrowed<T> = ZodDef & T;

function defOf(schema: unknown): ZodDef {
  return (schema as { _def: ZodDef })._def;
}

function narrow<T>(def: ZodDef): Narrowed<T> {
  return def as Narrowed<T>;
}

function isOptional(schema: unknown): boolean {
  return (schema as { isOptional: () => boolean }).isOptional();
}

/**
 * The zod schema is the single source: the advertised JSON Schema is derived from
 * it, so a constraint cannot be enforced at execute time without also being
 * advertised. An unsupported construct throws at import rather than emitting a
 * schema that understates what the validator will reject.
 */
export function toJsonSchema(schema: unknown): JsonSchema {
  const def = defOf(schema);
  const body = convert(schema, def);
  return def.description === undefined ? body : { ...body, description: def.description };
}

function convert(schema: unknown, def: ZodDef): JsonSchema {
  switch (def.typeName) {
    case "ZodOptional":
      return toJsonSchema(def.innerType);
    case "ZodDefault":
      return { ...toJsonSchema(def.innerType), default: narrow<{ defaultValue: () => unknown }>(def).defaultValue() };
    case "ZodNullable":
      return { anyOf: [toJsonSchema(def.innerType), { type: "null" }] };
    // A refinement is a runtime-only predicate with nothing to introspect, so the
    // derived schema is the unrefined one. State such a rule in the field's
    // description, because JSON Schema validation alone will not enforce it.
    case "ZodEffects":
      return toJsonSchema(def.schema);
    case "ZodObject":
      return objectSchema(def);
    case "ZodArray":
      return arraySchema(def);
    case "ZodUnion":
      return { anyOf: narrow<{ options: readonly unknown[] }>(def).options.map((o) => toJsonSchema(o)) };
    case "ZodEnum":
      return { type: "string", enum: [...narrow<{ values: readonly string[] }>(def).values] };
    case "ZodLiteral":
      return literalSchema(def.value);
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodNumber":
      return numberSchema(narrow<{ checks: readonly ZodCheck[] }>(def).checks);
    case "ZodString":
      return stringSchema(narrow<{ checks: readonly ZodCheck[] }>(def).checks);
    default:
      throw new Error(
        `toJsonSchema cannot derive a JSON Schema from ${def.typeName}; extend it before using that construct in a tool schema. Schema: ${String(schema)}`,
      );
  }
}

function objectSchema(def: ZodDef): JsonSchema {
  if (def.unknownKeys !== "strict") {
    throw new Error(
      `A tool object schema must be .strict() so the advertised schema can close it to additional properties; this one is "${def.unknownKeys}".`,
    );
  }
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, child] of Object.entries(narrow<{ shape: () => Record<string, unknown> }>(def).shape())) {
    properties[key] = toJsonSchema(child);
    if (!isOptional(child)) {
      required.push(key);
    }
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function arraySchema(def: ZodDef): JsonSchema {
  const schema: Record<string, unknown> = { type: "array", items: toJsonSchema(def.type) };
  if (def.minLength) {
    schema["minItems"] = def.minLength.value;
  }
  if (def.maxLength) {
    schema["maxItems"] = def.maxLength.value;
  }
  return schema as JsonSchema;
}

function literalSchema(value: unknown): JsonSchema {
  const type = typeof value;
  if (type !== "string" && type !== "number" && type !== "boolean") {
    throw new Error(`toJsonSchema supports string, number and boolean literals, not ${type}.`);
  }
  return { type, enum: [value as string | number | boolean] };
}

function numberSchema(checks: readonly ZodCheck[]): JsonSchema {
  const schema: Record<string, unknown> = { type: checks.some((check) => check.kind === "int") ? "integer" : "number" };
  for (const check of checks) {
    if (check.kind === "int") {
      continue;
    }
    if (check.kind === "min") {
      schema[check.inclusive ? "minimum" : "exclusiveMinimum"] = check.value;
    } else if (check.kind === "max") {
      schema[check.inclusive ? "maximum" : "exclusiveMaximum"] = check.value;
    } else {
      throw new Error(`toJsonSchema does not know how to advertise the number check "${check.kind}".`);
    }
  }
  return schema as JsonSchema;
}

function stringSchema(checks: readonly ZodCheck[]): JsonSchema {
  const schema: Record<string, unknown> = { type: "string" };
  for (const check of checks) {
    if (check.kind === "min") {
      schema["minLength"] = check.value;
    } else if (check.kind === "max") {
      schema["maxLength"] = check.value;
    } else if (check.kind === "regex") {
      schema["pattern"] = (check as { regex: RegExp }).regex.source;
    } else {
      throw new Error(`toJsonSchema does not know how to advertise the string check "${check.kind}".`);
    }
  }
  return schema as JsonSchema;
}
