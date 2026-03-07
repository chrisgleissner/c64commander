import { z } from "zod";
import { assertionCatalog } from "../../catalog.js";
import { defineToolModule, parseZodArgs } from "../types.js";
import { jsonResult } from "../responses.js";

const recordAssertionSchema = z.object({
  runId: z.string().min(1),
  assertionId: z.string().min(1),
  title: z.string().min(1),
  oracleClass: z.string().min(1),
  passed: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const assertModule = defineToolModule({
  domain: "scope_assert",
  summary: "Assertion catalog and assertion recording.",
  tools: [
    {
      name: "scope_assert.list_assertions",
      description: "List the built-in assertion definitions.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        return jsonResult({
          ok: true,
          runId: "scope-assert",
          timestamp: new Date().toISOString(),
          data: {
            assertions: assertionCatalog,
          },
        });
      },
    },
    {
      name: "scope_assert.record_assertion",
      description: "Record an assertion result for a run.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          assertionId: { type: "string" },
          title: { type: "string" },
          oracleClass: { type: "string" },
          passed: { type: "boolean" },
          details: { type: "object" },
        },
        required: ["runId", "assertionId", "title", "oracleClass", "passed"],
        additionalProperties: false,
      },
      async execute(args, ctx) {
        const parsed = parseZodArgs(recordAssertionSchema, args);
        return jsonResult(await ctx.sessionStore.recordAssertion(parsed));
      },
    },
  ],
});
