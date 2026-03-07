import { caseCatalog, testNamespaces } from "../../catalog/index.js";
import { buildReadyCaseSet, evaluateCase, selectNextCase } from "../../caseRunner.js";
import { defineToolModule, parseZodArgs } from "../types.js";
import { jsonResult } from "../responses.js";
import { z } from "zod";

const completedCasesSchema = z.object({
  completedCaseIds: z.array(z.string()).optional().default([]),
});

export const catalogModule = defineToolModule({
  domain: "scope_catalog",
  summary: "Catalog surfaces for built-in cases and case execution planning.",
  tools: [
    {
      name: "scope_catalog.list_cases",
      description: "List the built-in case catalog currently available to c64scope.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        return jsonResult({
          ok: true,
          runId: "scope-catalog",
          timestamp: new Date().toISOString(),
          data: {
            cases: caseCatalog,
          },
        });
      },
    },
    {
      name: "scope_catalog.get_ready_cases",
      description: "Get the prioritized set of ready and blocked cases given a set of already-completed case IDs.",
      inputSchema: {
        type: "object",
        properties: {
          completedCaseIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of cases already completed in this session.",
          },
        },
        additionalProperties: false,
      },
      async execute(args) {
        const { completedCaseIds } = parseZodArgs(completedCasesSchema, args);
        const result = buildReadyCaseSet(new Set(completedCaseIds));
        return jsonResult({
          ok: true,
          runId: "scope-catalog",
          timestamp: new Date().toISOString(),
          data: {
            readyCases: result.ready,
            blockedCases: result.blocked,
            testNamespaces,
          },
        });
      },
    },
    {
      name: "scope_catalog.select_next_case",
      description: "Select the next highest-priority executable case given completed case IDs.",
      inputSchema: {
        type: "object",
        properties: {
          completedCaseIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of cases already completed in this session.",
          },
        },
        additionalProperties: false,
      },
      async execute(args) {
        const { completedCaseIds } = parseZodArgs(completedCasesSchema, args);
        const evaluation = selectNextCase(new Set(completedCaseIds));
        return jsonResult({
          ok: true,
          runId: "scope-catalog",
          timestamp: new Date().toISOString(),
          data: {
            evaluation,
          },
        });
      },
    },
    {
      name: "scope_catalog.evaluate_case",
      description: "Evaluate whether a specific case can be executed given completed case IDs.",
      inputSchema: {
        type: "object",
        properties: {
          caseId: {
            type: "string",
            description: "The case ID to evaluate.",
          },
          completedCaseIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of cases already completed in this session.",
          },
        },
        required: ["caseId"],
        additionalProperties: false,
      },
      async execute(args) {
        const parsed = parseZodArgs(
          z.object({
            caseId: z.string(),
            completedCaseIds: z.array(z.string()).optional().default([]),
          }),
          args,
        );
        const evaluation = evaluateCase(parsed.caseId, new Set(parsed.completedCaseIds));
        return jsonResult({
          ok: true,
          runId: "scope-catalog",
          timestamp: new Date().toISOString(),
          data: {
            evaluation,
          },
        });
      },
    },
  ],
});
