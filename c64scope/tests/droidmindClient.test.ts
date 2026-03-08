/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn();
const closeMock = vi.fn();
const callToolMock = vi.fn();
const clientCtorMock = vi.fn().mockImplementation(() => ({
  connect: connectMock,
  close: closeMock,
  callTool: callToolMock,
}));
const transportCtorMock = vi.fn().mockImplementation(() => ({}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: clientCtorMock,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: transportCtorMock,
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  CallToolResultSchema: {},
}));

describe("droidmind client", () => {
  beforeEach(() => {
    vi.resetModules();
    connectMock.mockReset();
    closeMock.mockReset();
    callToolMock.mockReset();
  });

  it("lists devices and unwraps shell command text", async () => {
    callToolMock
      .mockResolvedValueOnce({ isError: false, content: [{ type: "text", text: "serial-1" }] })
      .mockResolvedValueOnce({ isError: false, content: [{ type: "text", text: "```sh\npm list packages\n```" }] });

    const { DroidmindClient } = await import("../src/validation/droidmindClient.js");
    const client = new DroidmindClient("uvx", ["droidmind"]);

    expect(await client.listDevices()).toBe("serial-1");
    expect(await client.shell("serial-1", "pm list packages")).toBe("pm list packages");
    await client.close();
    expect(connectMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
  });

  it("throws when tool calls fail and writes screenshots from base64 payload", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "c64scope-droidmind-"));
    const imagePath = path.join(tempDir, "shot.png");
    callToolMock
      .mockResolvedValueOnce({
        isError: false,
        content: [{ type: "image", data: Buffer.from("abc").toString("base64"), mimeType: "image/png" }],
      })
      .mockResolvedValueOnce({ isError: true, content: [{ type: "text", text: "boom" }] })
      .mockResolvedValueOnce({ isError: false });

    const { DroidmindClient } = await import("../src/validation/droidmindClient.js");
    const client = new DroidmindClient();

    try {
      await client.screenshotToFile("serial-1", imagePath);
      expect((await readFile(imagePath)).toString()).toBe("abc");
      await expect(client.startApp("serial-1", "pkg")).rejects.toThrow(/android-app\/start_app failed: boom/);
      await expect(client.screenshotToFile("serial-1", imagePath)).rejects.toThrow(/without image content/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("routes UI commands through the expected MCP tools and handles structured failures", async () => {
    callToolMock
      .mockResolvedValueOnce({ isError: false })
      .mockResolvedValueOnce({ isError: false })
      .mockResolvedValueOnce({ isError: false })
      .mockResolvedValueOnce({ isError: false })
      .mockResolvedValueOnce({ isError: false, content: [{ type: "text", text: "plain output" }] })
      .mockResolvedValueOnce({ isError: true, structuredContent: { detail: "bad tap" } })
      .mockResolvedValueOnce({ isError: false, content: [{ type: "text", text: "missing image" }] });

    const { DroidmindClient } = await import("../src/validation/droidmindClient.js");
    const client = new DroidmindClient();

    await client.stopApp("serial-2", "pkg");
    await client.tap("serial-2", 10, 20);
    await client.swipe("serial-2", 1, 2, 3, 4);
    await client.pressKey("serial-2", 82);
    expect(await client.shell("serial-2", "echo hi")).toBe("plain output");
    await expect(client.inputText("serial-2", "hello")).rejects.toThrow(/android-ui\/input_text failed/);
    await expect(client.screenshotToFile("serial-2", path.join(process.cwd(), "ignored.png"))).rejects.toThrow(
      /did not return image data/,
    );

    expect(callToolMock).toHaveBeenNthCalledWith(
      1,
      { name: "android-app", arguments: { serial: "serial-2", action: "stop_app", package: "pkg" } },
      {},
    );
    expect(callToolMock).toHaveBeenNthCalledWith(
      2,
      { name: "android-ui", arguments: { serial: "serial-2", action: "tap", x: 10, y: 20 } },
      {},
    );
    expect(connectMock).toHaveBeenCalledTimes(1);
  });
});
