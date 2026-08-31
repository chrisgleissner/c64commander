/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec §11.3: the JSON Schema advertised over tools/list and the zod schema that
 * validates at execute time drift. This walks the registry so a tool added later
 * is covered the day it is added.
 */

import Ajv from "ajv";
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

const descriptors = listToolDescriptors();

describe("tool contract", () => {
  it("registers exactly the 25 tools of the specified surface, each name unique", () => {
    const names = descriptors.map((descriptor) => descriptor.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(
      [
        "droid_app.clear_app_data",
        "droid_app.install_app",
        "droid_app.launch_app",
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
        "droid_input.type_text",
        "droid_target.describe_target",
        "droid_target.list_targets",
      ].sort(),
    );
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
