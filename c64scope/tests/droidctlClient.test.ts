/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn();
const closeMock = vi.fn();
const callToolMock = vi.fn();
const listToolsMock = vi.fn();
const clientCtorMock = vi.fn().mockImplementation(function ClientMock() {
  return { connect: connectMock, close: closeMock, callTool: callToolMock, listTools: listToolsMock };
});
const transportCtorMock = vi.fn().mockImplementation(function StdioClientTransportMock() {
  return {};
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: clientCtorMock }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: transportCtorMock }));
vi.mock("@modelcontextprotocol/sdk/types.js", () => ({ CallToolResultSchema: {} }));

const SERIAL = "9B081FFAZ001WX";
const TARGET_ID = `adb:${SERIAL}`;
const PACKAGE = "uk.gleissner.c64commander";

function envelope(data: Record<string, unknown>) {
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify({ ok: true, runId: "dc-TEST", timestamp: "now", data }) }],
  };
}

function failure(code: string, message: string) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, runId: "dc-TEST", timestamp: "now", error: { code, message } }),
      },
    ],
  };
}

const targets = envelope({ targets: [{ targetId: TARGET_ID, serial: SERIAL, transport: "adb", isEmulator: false }] });

function callsTo(name: string) {
  return callToolMock.mock.calls.filter((call) => call[0].name === name).map((call) => call[0].arguments);
}

async function loadClient() {
  const { DroidctlClient } = await import("../src/validation/droidctlClient.js");
  return new DroidctlClient("node", ["droidctl/scripts/start.mjs"]);
}

describe("droidctl client", () => {
  beforeEach(() => {
    vi.resetModules();
    connectMock.mockReset();
    closeMock.mockReset();
    callToolMock.mockReset();
    listToolsMock.mockReset();
    delete process.env.DROIDCTL_ARGS;
  });

  it("resolves a serial to droidctl's target id and caches it", async () => {
    callToolMock.mockResolvedValue(targets);
    const client = await loadClient();

    expect(await client.resolveTargetId(SERIAL)).toBe(TARGET_ID);
    expect(await client.resolveTargetId(SERIAL)).toBe(TARGET_ID);
    expect(callsTo("droid_target.list_targets")).toHaveLength(1);
  });

  it("refuses a serial that is not connected instead of using another target", async () => {
    callToolMock.mockResolvedValue(
      envelope({ targets: [{ targetId: "adb:emulator-5554", serial: "emulator-5554", transport: "adb" }] }),
    );
    const client = await loadClient();

    await expect(client.resolveTargetId(SERIAL)).rejects.toThrow(
      /Expected exactly one connected target with serial 9B081FFAZ001WX, found 0/,
    );
    expect(callsTo("droid_input.tap")).toEqual([]);
  });

  it("refuses a serial that matches more than one target", async () => {
    callToolMock.mockResolvedValue(
      envelope({
        targets: [
          { targetId: "adb:dup", serial: SERIAL, transport: "adb" },
          { targetId: "ssh:dup", serial: SERIAL, transport: "ssh" },
        ],
      }),
    );
    const client = await loadClient();
    await expect(client.resolveTargetId(SERIAL)).rejects.toThrow(/found 2/);
  });

  it("turns a droidctl error envelope into a throw naming the code and message", async () => {
    callToolMock.mockResolvedValueOnce(targets).mockResolvedValueOnce(failure("device_error", "input tap 1 2 failed"));
    const client = await loadClient();

    await expect(client.tap(SERIAL, 1, 2)).rejects.toThrow(
      /droid_input\.tap failed \[device_error\]: input tap 1 2 failed/,
    );
  });

  it("rejects a payload that is not the droidctl envelope", async () => {
    callToolMock.mockResolvedValueOnce({ isError: false, content: [{ type: "text", text: "not json" }] });
    const client = await loadClient();
    await expect(client.listDevices()).rejects.toThrow(/returned a non-JSON payload/);
  });

  it("routes lifecycle and input through the droidctl tools with an explicit target and package", async () => {
    callToolMock.mockResolvedValue(targets);
    callToolMock.mockImplementation(async (request: { name: string }) =>
      request.name === "droid_target.list_targets" ? targets : envelope({}),
    );
    const client = await loadClient();

    await client.startApp(SERIAL, PACKAGE);
    await client.stopApp(SERIAL, PACKAGE);
    await client.tap(SERIAL, 10, 20);
    await client.swipe(SERIAL, 1, 2, 3, 4, 300);
    await client.pressKey(SERIAL, 20);
    await client.inputText(SERIAL, "hello");

    expect(callsTo("droid_app.start_app")).toEqual([
      { targetId: TARGET_ID, package: PACKAGE, activity: ".MainActivity" },
    ]);
    expect(callsTo("droid_app.stop_app")).toEqual([{ targetId: TARGET_ID, package: PACKAGE }]);
    expect(callsTo("droid_input.tap")).toEqual([{ targetId: TARGET_ID, x: 10, y: 20 }]);
    expect(callsTo("droid_input.swipe")).toEqual([
      { targetId: TARGET_ID, x1: 1, y1: 2, x2: 3, y2: 4, durationMs: 300 },
    ]);
    expect(callsTo("droid_input.press_key")).toEqual([{ targetId: TARGET_ID, keycode: 20 }]);
    expect(callsTo("droid_input.input_text")).toEqual([{ targetId: TARGET_ID, text: "hello" }]);
  });

  it("runs a shell line through sh -c, because run_shell takes an argument vector", async () => {
    callToolMock.mockImplementation(async (request: { name: string }) =>
      request.name === "droid_target.list_targets" ? targets : envelope({ stdout: "isKeyguardShowing=false\n" }),
    );
    const client = await loadClient();

    expect(await client.shell(SERIAL, "dumpsys window | grep isKeyguardShowing")).toBe("isKeyguardShowing=false");
    expect(callsTo("droid_device.run_shell")).toEqual([
      { targetId: TARGET_ID, command: ["sh", "-c", "dumpsys window | grep isKeyguardShowing"] },
    ]);
  });

  it("reads the hierarchy back from the path droidctl wrote, with no retry loop of its own", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-client-"));
    const xmlPath = path.join(dir, "ui.xml");
    await writeFile(xmlPath, '<hierarchy><node bounds="[0,0][1080,2280]" /></hierarchy>');
    callToolMock.mockImplementation(async (request: { name: string }) =>
      request.name === "droid_target.list_targets" ? targets : envelope({ xmlPath, nodeCount: 1 }),
    );

    try {
      const client = await loadClient();
      expect(await client.captureUiHierarchy(SERIAL)).toContain("<hierarchy");
      // One capture call: the settle poll and retries live in droidctl now.
      expect(callsTo("droid_capture.ui_hierarchy")).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails when the hierarchy tool returns no path", async () => {
    callToolMock.mockImplementation(async (request: { name: string }) =>
      request.name === "droid_target.list_targets" ? targets : envelope({}),
    );
    const client = await loadClient();
    await expect(client.captureUiHierarchy(SERIAL)).rejects.toThrow(/returned no xmlPath/);
  });

  it("copies the captured screenshot to the path the caller asked for", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-shot-"));
    const rawPath = path.join(dir, "captured.png");
    await writeFile(rawPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const localPath = path.join(dir, "af-home-shell.png");
    callToolMock.mockImplementation(async (request: { name: string }) =>
      request.name === "droid_target.list_targets" ? targets : envelope({ rawPath }),
    );

    try {
      const client = await loadClient();
      await client.screenshotToFile(SERIAL, localPath);
      expect(await readFile(localPath)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      expect(callsTo("droid_capture.screenshot")).toEqual([
        { targetId: TARGET_ID, name: "af-home-shell", runRoot: dir },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("scrolls with hierarchy-derived coordinates and reports atEnd from unchanged keys", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-scroll-"));
    const xmlPath = path.join(dir, "ui.xml");
    await writeFile(xmlPath, '<hierarchy><node bounds="[0,0][1080,2280]" /></hierarchy>');
    callToolMock.mockImplementation(async (request: { name: string }) =>
      request.name === "droid_target.list_targets" ? targets : envelope({ xmlPath }),
    );

    try {
      const client = await loadClient();
      expect(await client.scrollDown(SERIAL)).toEqual({ atEnd: true });
      expect(callsTo("droid_input.swipe")).toEqual([
        { targetId: TARGET_ID, x1: 540, y1: 1710, x2: 540, y2: 650, durationMs: 300 },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("discovers droidctl tool capabilities and reports a missing one", async () => {
    listToolsMock.mockResolvedValue({
      tools: [
        { name: "droid_target.list_targets", inputSchema: { properties: {} } },
        { name: "droid_app.start_app", inputSchema: { properties: {} } },
        { name: "droid_app.stop_app", inputSchema: { properties: {} } },
        { name: "droid_input.tap", inputSchema: { properties: {} } },
        { name: "droid_input.swipe", inputSchema: { properties: {} } },
        { name: "droid_input.press_key", inputSchema: { properties: {} } },
        { name: "droid_input.input_text", inputSchema: { properties: {} } },
        { name: "droid_device.run_shell", inputSchema: { properties: {} } },
        { name: "droid_capture.ui_hierarchy", inputSchema: { properties: {} } },
      ],
    });
    const client = await loadClient();

    expect((await client.listTools()).length).toBe(9);
    const check = await client.checkCapabilities();
    expect(check.satisfied).toBe(false);
    expect(check.missing.map((item) => item.id)).toEqual(["screenshot"]);
  });

  it("connects once, and treats close before connect as a no-op", async () => {
    callToolMock.mockResolvedValue(targets);
    const client = await loadClient();

    await client.close();
    expect(closeMock).not.toHaveBeenCalled();

    await client.listDevices();
    await client.listDevices();
    expect(connectMock).toHaveBeenCalledTimes(1);

    await client.close();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("honours a custom command and argument vector", async () => {
    const { DroidctlClient } = await import("../src/validation/droidctlClient.js");
    new DroidctlClient("node", ["/custom/start.mjs"]);
    expect(transportCtorMock).toHaveBeenCalledWith({ command: "node", args: ["/custom/start.mjs"] });
  });
});
