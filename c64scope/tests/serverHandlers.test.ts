import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { describe, expect, it, vi } from "vitest";
import { createScopeServerRuntime, runScopeServer, toCallToolResult } from "../src/server.js";

type RequestHandler = (
  request: { method: string; params?: Record<string, unknown> },
  extra: unknown,
) => Promise<unknown>;

function getHandler(runtime: ReturnType<typeof createScopeServerRuntime>, method: string): RequestHandler {
  const handlers = (runtime.server as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) {
    throw new Error(`Missing handler for ${method}`);
  }
  return handler;
}

describe("server MCP handlers", () => {
  it("serves tools, resources, prompts, and handled tool failures", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-handlers-"));
    const runtime = createScopeServerRuntime({ artifactRoot });

    try {
      const listTools = await getHandler(runtime, "tools/list")({ method: "tools/list" }, {});
      expect((listTools as { tools: unknown[] }).tools.length).toBeGreaterThanOrEqual(6);

      const listResources = await getHandler(runtime, "resources/list")({ method: "resources/list" }, {});
      expect((listResources as { resources: unknown[] }).resources).toHaveLength(5);

      const readResource = await getHandler(runtime, "resources/read")(
        {
          method: "resources/read",
          params: { uri: "c64scope://catalog/playbooks" },
        },
        {},
      );
      expect(JSON.stringify(readResource)).toContain("Playbook References");

      await expect(
        getHandler(runtime, "resources/read")(
          {
            method: "resources/read",
            params: { uri: "c64scope://missing" },
          },
          {},
        ),
      ).rejects.toThrow("Unknown resource: c64scope://missing");

      const listPrompts = await getHandler(runtime, "prompts/list")({ method: "prompts/list" }, {});
      expect((listPrompts as { prompts: unknown[] }).prompts).toHaveLength(1);

      const getPrompt = await getHandler(runtime, "prompts/get")(
        {
          method: "prompts/get",
          params: {
            name: "agentic_physical_case",
            arguments: { caseId: "mixed-format-playback" },
          },
        },
        {},
      );
      expect(JSON.stringify(getPrompt)).toContain("mixed-format-playback");

      await expect(
        getHandler(runtime, "prompts/get")(
          {
            method: "prompts/get",
            params: { name: "missing" },
          },
          {},
        ),
      ).rejects.toThrow("Unknown prompt: missing");

      const toolFailure = await getHandler(runtime, "tools/call")(
        {
          method: "tools/call",
          params: { name: "scope_catalog.missing", arguments: {} },
        },
        {},
      );
      expect((toolFailure as { isError?: boolean }).isError).toBe(true);
      expect(JSON.stringify(toolFailure)).toContain("Unknown tool: scope_catalog.missing");

      const validTool = await getHandler(runtime, "tools/call")(
        {
          method: "tools/call",
          params: { name: "scope_catalog.list_cases", arguments: {} },
        },
        {},
      );
      expect(JSON.stringify(validTool)).toContain("nav-route-shell");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("connects the server over stdio in runScopeServer", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-connect-"));
    const connectSpy = vi.spyOn(Server.prototype, "connect").mockResolvedValue(undefined as never);

    try {
      const runtime = await runScopeServer({ artifactRoot });
      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(runtime.artifactRoot).toBe(artifactRoot);
    } finally {
      connectSpy.mockRestore();
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("converts internal tool results into MCP call-tool results", () => {
    const withStructured = toCallToolResult({
      content: [{ type: "text", text: "hello" }],
      structuredContent: { type: "json", data: { ok: true } },
      isError: true,
    });
    const withoutStructured = toCallToolResult({
      content: [{ type: "text", text: "plain" }],
    });

    expect(withStructured.structuredContent).toEqual({ ok: true });
    expect(withStructured.isError).toBe(true);
    expect(withoutStructured.structuredContent).toBeUndefined();
    expect(withoutStructured.isError).toBeUndefined();
  });
});
