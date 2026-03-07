import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import { prompts } from "../src/promptDefinitions.js";
import { createPromptRegistry } from "../src/promptsRegistry.js";
import { listResources, readResource } from "../src/resources.js";
import { ScopeSessionStore } from "../src/sessionStore.js";
import { ToolExecutionError, ToolValidationError, toolErrorResult, unknownErrorResult } from "../src/tools/errors.js";
import { jsonResult, textResult } from "../src/tools/responses.js";
import { defineToolModule, parseZodArgs } from "../src/tools/types.js";
import { createRunId, errorResult, okResult, toToolResponse } from "../src/types.js";

const originalDebug = process.env.C64SCOPE_DEBUG;

afterEach(() => {
  process.env.C64SCOPE_DEBUG = originalDebug;
  vi.restoreAllMocks();
});

describe("runtime primitives", () => {
  it("formats logger output for debug and fallback cases", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger("scope-test");

    logger.debug("hidden");
    expect(consoleSpy).not.toHaveBeenCalled();

    process.env.C64SCOPE_DEBUG = "1";
    logger.debug("visible", { ok: true });
    logger.info("info", { value: 1 });
    logger.warn("warn");

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.error("boom", circular);

    expect(consoleSpy).toHaveBeenCalledTimes(4);
    expect(consoleSpy.mock.calls[0]?.[0]).toContain("[scope-test] visible");
    expect(consoleSpy.mock.calls[3]?.[0]).toBe("[scope-test] boom");
  });

  it("lists and resolves prompts and resources", () => {
    const promptRegistry = createPromptRegistry();
    const prompts = promptRegistry.list();
    const resolved = promptRegistry.resolve("agentic_physical_case", { caseId: 42 });

    expect(prompts).toHaveLength(1);
    expect(resolved.arguments.caseId).toBe("42");
    expect(resolved.messages[0]?.content).toContain("Load case metadata for 42.");
    expect(() => promptRegistry.resolve("missing", {})).toThrow("Unknown prompt: missing");

    const resources = listResources();
    expect(resources).toHaveLength(5);
    expect(readResource("c64scope://catalog/cases")?.readText()).toContain("play-transport-playback");
    expect(readResource("c64scope://catalog/assertions")?.readText()).toContain("playback-start-visible");
    expect(readResource("c64scope://catalog/playbooks")?.readText()).toContain("Playbook References");
    expect(readResource("c64scope://schema/artifact-bundle")?.readText()).toContain("summary.md");
    expect(readResource("c64scope://catalog/failure-taxonomy")?.readText()).toContain("product_failure");
    expect(readResource("c64scope://missing")).toBeUndefined();
  });

  it("falls back to empty prompt resources and tools when omitted", () => {
    prompts.push({
      name: "temporary_prompt",
      title: "Temporary Prompt",
      description: "Used for fallback coverage.",
      render: () => "temporary",
    });

    try {
      const promptRegistry = createPromptRegistry();
      const resolved = promptRegistry.resolve("temporary_prompt", {});
      expect(resolved.resources).toEqual([]);
      expect(resolved.tools).toEqual([]);
    } finally {
      prompts.pop();
    }
  });

  it("builds structured results and tool errors", () => {
    const ok = okResult("run-1", { ready: true });
    const failed = errorResult("run-1", "invalid_input", "bad", { field: "caseId" });
    const tool = toToolResponse(ok);
    const text = textResult("hello", { kind: "text" });
    const json = jsonResult({ value: 1 }, { kind: "json" });
    const stringJson = jsonResult("plain-text");
    const validationError = new ToolValidationError("invalid", { details: { path: "$.runId" } });
    const executionError = new ToolExecutionError("failed", { details: { step: "capture" } });

    expect(createRunId()).toMatch(/^pt-\d{8}T\d{6}Z$/);
    expect(failed.ok).toBe(false);
    expect(tool.isError).toBe(false);
    expect(text.metadata?.kind).toBe("text");
    expect(json.structuredContent?.data).toEqual({ value: 1 });
    expect(stringJson.content[0]?.text).toBe("plain-text");
    expect(toolErrorResult(validationError).isError).toBe(true);
    expect(toolErrorResult(executionError).content[0]?.text).toContain("execution");
    expect(unknownErrorResult(validationError).content[0]?.text).toContain("invalid");
    expect(unknownErrorResult(new Error("boom")).content[0]?.text).toContain("boom");
    expect(unknownErrorResult("panic").content[0]?.text).toContain("panic");
  });

  it("validates tool modules and zod arguments", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-primitives-"));
    const module = defineToolModule({
      domain: "test",
      summary: "Test module",
      tools: [
        {
          name: "test.echo",
          description: "Echo tool",
          inputSchema: { type: "object" },
          async execute(args) {
            return jsonResult(args);
          },
        },
      ],
    });

    try {
      const sessionStore = new ScopeSessionStore(artifactRoot);
      const logger = createLogger("test");
      const invoked = await module.invoke("test.echo", { hello: "world" }, { sessionStore, logger });

      expect(module.describeTools()[0]?.metadata.domain).toBe("test");
      expect(invoked.content[0]?.text).toContain("world");
      expect(() => parseZodArgs(z.object({ runId: z.string().min(1) }), { runId: "" })).toThrow(
        "Tool input did not match the expected schema.",
      );
      expect(() =>
        parseZodArgs(
          {
            parse: () => {
              throw new Error("explode");
            },
          },
          {},
        ),
      ).toThrow("explode");
      await expect(module.invoke("test.missing", {}, { sessionStore, logger })).rejects.toThrow(
        "Unknown tool: test.missing",
      );
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});
