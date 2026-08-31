/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { describe, expect, it, vi } from "vitest";
import { createDroidctlServerRuntime, runDroidctlServer, toCallToolResult } from "../src/server.js";
import { FakeTransport } from "../src/transport/fake.js";

type RequestHandler = (
  request: { method: string; params?: Record<string, unknown> },
  extra: unknown,
) => Promise<unknown>;

function getHandler(runtime: ReturnType<typeof createDroidctlServerRuntime>, method: string): RequestHandler {
  const handlers = (runtime.server as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) {
    throw new Error(`Missing handler for ${method}`);
  }
  return handler;
}

describe("server MCP handlers", () => {
  it("serves tools, resources and handled tool failures", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "droidctl-handlers-"));
    const runtime = createDroidctlServerRuntime({ artifactRoot, transports: [new FakeTransport()] });

    try {
      const listTools = (await getHandler(runtime, "tools/list")({ method: "tools/list" }, {})) as {
        tools: { name: string; inputSchema: unknown }[];
      };
      expect(listTools.tools).toHaveLength(25);
      expect(listTools.tools.every((tool) => tool.inputSchema !== undefined)).toBe(true);
      expect(listTools.tools.map((tool) => tool.name)).toContain("droid_capture.screenshot");

      const listResources = (await getHandler(runtime, "resources/list")({ method: "resources/list" }, {})) as {
        resources: unknown[];
      };
      expect(listResources.resources).toHaveLength(4);

      const readResource = await getHandler(runtime, "resources/read")(
        { method: "resources/read", params: { uri: "droidctl://reference/keycodes" } },
        {},
      );
      expect(JSON.stringify(readResource)).toContain("KEYCODE_DPAD_DOWN");

      await expect(
        getHandler(runtime, "resources/read")({ method: "resources/read", params: { uri: "droidctl://missing" } }, {}),
      ).rejects.toThrow("Unknown resource: droidctl://missing");

      const unknownTool = (await getHandler(runtime, "tools/call")(
        { method: "tools/call", params: { name: "droid_target.missing", arguments: {} } },
        {},
      )) as { isError?: boolean };
      expect(unknownTool.isError).toBe(true);
      expect(JSON.stringify(unknownTool)).toContain("Unknown tool: droid_target.missing");

      const validTool = await getHandler(runtime, "tools/call")(
        { method: "tools/call", params: { name: "droid_target.list_targets", arguments: {} } },
        {},
      );
      expect(JSON.stringify(validTool)).toContain("adb:TESTSERIAL01");

      const validationFailure = (await getHandler(runtime, "tools/call")(
        { method: "tools/call", params: { name: "droid_app.stop_app", arguments: {} } },
        {},
      )) as { isError?: boolean };
      expect(validationFailure.isError).toBe(true);
      expect(JSON.stringify(validationFailure)).toContain("invalid_input");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("defaults to the adb and ssh transports when none are injected", () => {
    const runtime = createDroidctlServerRuntime({ artifactRoot: os.tmpdir(), runId: "dc-DEFAULTS" });
    expect(runtime.transports.kinds()).toEqual(["adb", "ssh"]);
  });

  it("connects the server over stdio in runDroidctlServer", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "droidctl-connect-"));
    const connectSpy = vi.spyOn(Server.prototype, "connect").mockResolvedValue(undefined as never);

    try {
      const runtime = await runDroidctlServer({ artifactRoot, transports: [new FakeTransport()] });
      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(runtime.artifacts.runDir.startsWith(artifactRoot)).toBe(true);
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
    const withoutStructured = toCallToolResult({ content: [{ type: "text", text: "plain" }] });

    expect(withStructured.structuredContent).toEqual({ ok: true });
    expect(withStructured.isError).toBe(true);
    expect(withoutStructured.structuredContent).toBeUndefined();
    expect(withoutStructured.isError).toBeUndefined();
  });
});
