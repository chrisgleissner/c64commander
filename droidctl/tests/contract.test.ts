/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec §11.3: the JSON Schema advertised over tools/list and the zod schema that
 * validates at execute time drift. The advertised schema is derived from the zod
 * schema now, so this pins what derivation must preserve: the surface a caller
 * sees, and agreement between both validators on every constraint.
 */

import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { ToolValidationError } from "../src/tools/errors.js";
import { listToolDescriptors } from "../src/tools/registry.js";
import type { JsonSchema } from "../src/tools/types.js";
import { parseZodArgs } from "../src/tools/types.js";

const ajv = new Ajv({ allErrors: true, strict: false });

interface ZodInternals {
  _def: {
    typeName: string;
    innerType?: unknown;
    schema?: unknown;
    type?: unknown;
    options?: unknown[];
    values?: unknown[];
    value?: unknown;
    checks?: { kind: string; regex?: RegExp; value?: number }[];
  };
  shape?: Record<string, unknown>;
  isOptional?: () => boolean;
}

const REGEX_CANDIDATES = ["480x640", "sample", "1", "a"];

function unwrap(schema: unknown): ZodInternals {
  return schema as ZodInternals;
}

function generate(schema: unknown, key: string): unknown {
  const node = unwrap(schema);
  const typeName = node._def.typeName;

  switch (typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return generate(node._def.innerType, key);
    case "ZodEffects":
      return generate(node._def.schema, key);
    case "ZodObject": {
      const value: Record<string, unknown> = {};
      for (const [field, child] of Object.entries(node.shape ?? {})) {
        value[field] = generate(child, field);
      }
      return value;
    }
    case "ZodArray":
      return [generate(node._def.type, key)];
    case "ZodUnion":
      return generate((node._def.options ?? [])[0], key);
    case "ZodEnum":
      return (node._def.values ?? [])[0];
    case "ZodLiteral":
      return node._def.value;
    case "ZodBoolean":
      return true;
    case "ZodNumber":
      return 1;
    case "ZodString": {
      const regex = (node._def.checks ?? []).find((check) => check.kind === "regex")?.regex;
      if (!regex) {
        return `${key}-value`;
      }
      const candidate = REGEX_CANDIDATES.find((value) => regex.test(value));
      if (!candidate) {
        throw new Error(`No sample string matches ${regex} for field ${key}; extend REGEX_CANDIDATES.`);
      }
      return candidate;
    }
    default:
      throw new Error(`The contract test does not know how to generate a ${typeName} (field ${key}).`);
  }
}

function zodRequiredKeys(schema: unknown): string[] {
  let node = unwrap(schema);
  while (node._def.typeName === "ZodEffects") {
    node = unwrap(node._def.schema);
  }
  return Object.entries(node.shape ?? {})
    .filter(([, child]) => unwrap(child).isOptional?.() !== true)
    .map(([key]) => key)
    .sort();
}

function objectSchemas(schema: JsonSchema, path: string): { path: string; schema: JsonSchema }[] {
  const found: { path: string; schema: JsonSchema }[] = [];
  if (schema.type === "object") {
    found.push({ path, schema });
  }
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    found.push(...objectSchemas(child, `${path}.${key}`));
  }
  const items = schema.items;
  if (items && !Array.isArray(items)) {
    found.push(...objectSchemas(items as JsonSchema, `${path}[]`));
  }
  return found;
}

/*
 * Values chosen to trip one constraint class each: minLength, pattern and enum
 * ("" and "x"), integer (1.5), exclusiveMinimum/minimum/maximum (0, -1, 65536),
 * minItems ([]), item type (["x"]) and the type itself (true, {}, null).
 */
const MUTATIONS: readonly unknown[] = ["", "x", 0, -1, 1.5, 65536, true, [], ["x"], {}, null];

/**
 * A zod refinement is a runtime-only predicate that no JSON Schema can carry, so
 * these two are expected to disagree. Listed here rather than skipped silently,
 * and asserted below so the list cannot rot.
 */
const RUNTIME_ONLY_CONSTRAINTS: readonly { tool: string; property: string; value: unknown }[] = [
  { tool: "droid_assert.assert_visible", property: "match", value: {} },
  { tool: "droid_assert.assert_not_visible", property: "match", value: {} },
];

/** Constraint keys derivation adds; stripped to compare against the advertised surface. */
const CONSTRAINT_KEYS = new Set([
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
]);

function withoutConstraints(schema: JsonSchema): unknown {
  const projected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (CONSTRAINT_KEYS.has(key)) {
      continue;
    }
    if (key === "type") {
      projected[key] = value === "integer" ? "number" : value;
    } else if (key === "properties") {
      projected[key] = Object.fromEntries(
        Object.entries(value as Record<string, JsonSchema>).map(([name, child]) => [name, withoutConstraints(child)]),
      );
    } else if (key === "items") {
      projected[key] = withoutConstraints(value as JsonSchema);
    } else if (key === "anyOf") {
      projected[key] = (value as JsonSchema[]).map(withoutConstraints);
    } else {
      projected[key] = value;
    }
  }
  return projected;
}

function zodAccepts(schema: unknown, payload: unknown): boolean {
  try {
    parseZodArgs(schema as { parse: (args: unknown) => unknown }, payload);
    return true;
  } catch {
    return false;
  }
}

const descriptors = listToolDescriptors();

const advertisedSurface = JSON.parse(
  readFileSync(new URL("./fixtures/advertisedSurface.json", import.meta.url), "utf8"),
) as { name: string; description: string; inputSchema: JsonSchema }[];

describe("tool contract", () => {
  it("registers exactly the 25 tools of the specified surface, each name unique", () => {
    const names = descriptors.map((descriptor) => descriptor.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(
      [
        "droid_app.clear_app_data",
        "droid_app.install_app",
        "droid_app.start_app",
        "droid_app.read_app_file",
        "droid_app.stop_app",
        "droid_app.uninstall_app",
        "droid_app.write_app_file",
        "droid_assert.assert_not_visible",
        "droid_assert.assert_visible",
        "droid_capture.logcat",
        "droid_capture.screenshot",
        "droid_capture.start_recording",
        "droid_capture.stop_recording",
        "droid_capture.ui_hierarchy",
        "droid_device.forward_webview",
        "droid_device.prepare_device",
        "droid_device.pull_file",
        "droid_device.push_file",
        "droid_device.run_shell",
        "droid_input.press_key",
        "droid_input.swipe",
        "droid_input.tap",
        "droid_input.input_text",
        "droid_target.describe_target",
        "droid_target.list_targets",
      ].sort(),
    );
  });

  it("still advertises the surface callers were given, once derived constraints are set aside", () => {
    const derived = descriptors
      .map((descriptor) => ({
        name: descriptor.name,
        description: descriptor.description,
        inputSchema: withoutConstraints(descriptor.inputSchema),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    expect(derived).toEqual(
      advertisedSurface
        .map((tool) => ({ ...tool, inputSchema: withoutConstraints(tool.inputSchema) }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  });

  it("keeps the runtime-only constraints listed, so the exception cannot rot", () => {
    for (const { tool, property, value } of RUNTIME_ONLY_CONSTRAINTS) {
      const descriptor = descriptors.find((candidate) => candidate.name === tool);
      expect(descriptor, tool).toBeDefined();
      const payload = generate(descriptor!.argsSchema, tool) as Record<string, unknown>;
      const mutated = { ...payload, [property]: value };
      expect({ tool, property, ajv: ajv.compile(descriptor!.inputSchema as object)(mutated) }).toEqual({
        tool,
        property,
        ajv: true,
      });
      expect({ tool, property, zod: zodAccepts(descriptor!.argsSchema, mutated) }).toEqual({
        tool,
        property,
        zod: false,
      });
    }
  });

  for (const descriptor of descriptors) {
    describe(descriptor.name, () => {
      it("declares the same required keys in the JSON Schema and the zod schema", () => {
        expect([...(descriptor.inputSchema.required ?? [])].sort()).toEqual(zodRequiredKeys(descriptor.argsSchema));
      });

      it("closes every object schema to additional properties", () => {
        for (const { path, schema } of objectSchemas(descriptor.inputSchema, descriptor.name)) {
          expect(`${path}:${schema.additionalProperties}`).toBe(`${path}:false`);
        }
      });

      it("declares a JSON Schema property for every zod key", () => {
        const declared = Object.keys(descriptor.inputSchema.properties ?? {}).sort();
        let node = unwrap(descriptor.argsSchema);
        while (node._def.typeName === "ZodEffects") {
          node = unwrap(node._def.schema);
        }
        expect(declared).toEqual(Object.keys(node.shape ?? {}).sort());
      });

      it("round-trips a generated payload through both schemas", () => {
        const payload = generate(descriptor.argsSchema, descriptor.name) as Record<string, unknown>;
        const validate = ajv.compile(descriptor.inputSchema as object);
        expect({ payload, errors: validate(payload) ? null : validate.errors }).toEqual({ payload, errors: null });
        expect(() => parseZodArgs(descriptor.argsSchema, payload)).not.toThrow();
      });

      it("rejects an unknown property with a ToolValidationError", () => {
        const payload = generate(descriptor.argsSchema, descriptor.name) as Record<string, unknown>;
        expect(() => parseZodArgs(descriptor.argsSchema, { ...payload, unexpectedKey: 1 })).toThrow(
          ToolValidationError,
        );
        const validate = ajv.compile(descriptor.inputSchema as object);
        expect(validate({ ...payload, unexpectedKey: 1 })).toBe(false);
      });

      it("agrees with the zod schema on every constraint, not only on which keys exist", () => {
        const validate = ajv.compile(descriptor.inputSchema as object);
        const payload = generate(descriptor.argsSchema, descriptor.name) as Record<string, unknown>;
        const exempt = new Set(
          RUNTIME_ONLY_CONSTRAINTS.filter((entry) => entry.tool === descriptor.name).map((entry) => entry.property),
        );
        const disagreements: string[] = [];
        for (const key of Object.keys(descriptor.inputSchema.properties ?? {})) {
          if (exempt.has(key)) {
            continue;
          }
          for (const value of MUTATIONS) {
            const mutated = { ...payload, [key]: value };
            const byAjv = validate(mutated);
            const byZod = zodAccepts(descriptor.argsSchema, mutated);
            if (byAjv !== byZod) {
              disagreements.push(`${key}=${JSON.stringify(value)}: JSON Schema ${byAjv}, zod ${byZod}`);
            }
          }
        }
        expect(disagreements).toEqual([]);
      });

      it("rejects a payload missing a required key", () => {
        const required = descriptor.inputSchema.required ?? [];
        if (required.length === 0) {
          return;
        }
        const payload = generate(descriptor.argsSchema, descriptor.name) as Record<string, unknown>;
        for (const key of required) {
          const { [key]: _removed, ...without } = payload;
          expect(() => parseZodArgs(descriptor.argsSchema, without)).toThrow(ToolValidationError);
          expect(ajv.compile(descriptor.inputSchema as object)(without)).toBe(false);
        }
      });
    });
  }
});
