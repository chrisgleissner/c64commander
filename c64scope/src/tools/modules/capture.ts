import { z } from "zod";
import { defineToolModule, parseZodArgs } from "../types.js";
import { jsonResult } from "../responses.js";

const reserveCaptureSchema = z.object({
    runId: z.string().min(1),
    endpoints: z.array(z.string().min(1)).optional(),
});

const runIdSchema = z.object({
    runId: z.string().min(1),
});

export const captureModule = defineToolModule({
    domain: "scope_capture",
    summary: "Capture reservation and lifecycle management.",
    tools: [
        {
            name: "scope_capture.reserve_capture",
            description: "Reserve capture endpoints for a run.",
            inputSchema: {
                type: "object",
                properties: {
                    runId: { type: "string" },
                    endpoints: { type: "array", items: { type: "string" } },
                },
                required: ["runId"],
                additionalProperties: false,
            },
            async execute(args, ctx) {
                const parsed = parseZodArgs(reserveCaptureSchema, args);
                return jsonResult(await ctx.sessionStore.reserveCapture(parsed));
            },
        },
        {
            name: "scope_capture.start_capture",
            description: "Start capture for a reserved run.",
            inputSchema: {
                type: "object",
                properties: {
                    runId: { type: "string" },
                },
                required: ["runId"],
                additionalProperties: false,
            },
            async execute(args, ctx) {
                const parsed = parseZodArgs(runIdSchema, args);
                return jsonResult(await ctx.sessionStore.startCapture(parsed.runId));
            },
        },
        {
            name: "scope_capture.stop_capture",
            description: "Stop active capture for a run.",
            inputSchema: {
                type: "object",
                properties: {
                    runId: { type: "string" },
                },
                required: ["runId"],
                additionalProperties: false,
            },
            async execute(args, ctx) {
                const parsed = parseZodArgs(runIdSchema, args);
                return jsonResult(await ctx.sessionStore.stopCapture(parsed.runId));
            },
        },
    ],
});
