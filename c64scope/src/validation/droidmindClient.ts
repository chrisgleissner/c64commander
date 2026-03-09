/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_DROIDMIND_COMMAND = process.env["DROIDMIND_COMMAND"] ?? "uvx";
const DEFAULT_DROIDMIND_ARGS = process.env["DROIDMIND_ARGS"]?.trim()
  ? process.env["DROIDMIND_ARGS"]!.split(/\s+/)
  : ["--from", "git+https://github.com/hyperb1iss/droidmind", "droidmind", "--transport", "stdio"];

type ClientCallToolResult = Awaited<ReturnType<Client["callTool"]>>;

function hasContent(result: ClientCallToolResult): result is Extract<ClientCallToolResult, { content: unknown[] }> {
  return "content" in result && Array.isArray(result.content);
}

function firstTextContent(result: ClientCallToolResult): string {
  if (!hasContent(result)) {
    return "";
  }
  const textItem = result.content.find(
    (item): item is { type: "text"; text: string } =>
      item.type === "text" && typeof (item as { text?: unknown }).text === "string",
  );
  return textItem?.text ?? "";
}

function unwrapCommandText(markdown: string): string {
  const match = markdown.match(/```(?:[a-zA-Z]+)?\n([\s\S]*?)```/);
  if (!match) {
    return markdown.trim();
  }
  return match[1]!.trim();
}

function assertToolSuccess(toolName: string, result: ClientCallToolResult): void {
  if (!result.isError) {
    return;
  }

  const structured = "structuredContent" in result ? result.structuredContent : undefined;
  const detail = firstTextContent(result) || JSON.stringify(structured ?? {});
  throw new Error(`${toolName} failed: ${detail}`);
}

export class DroidmindClient {
  private readonly client: Client;
  private readonly transport: StdioClientTransport;
  private connected = false;

  constructor(command: string = DEFAULT_DROIDMIND_COMMAND, args: readonly string[] = DEFAULT_DROIDMIND_ARGS) {
    this.client = new Client({ name: "c64scope-droidmind-client", version: "0.1.0" }, { capabilities: {} });
    this.transport = new StdioClientTransport({
      command,
      args: [...args],
    });
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.client.connect(this.transport);
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected) {
      return;
    }
    await this.client.close();
    this.connected = false;
  }

  async listDevices(): Promise<string> {
    const result = await this.callTool("android-device", {
      action: "list_devices",
    });
    return firstTextContent(result);
  }

  async startApp(serial: string, appPackage: string, activity: string = ".MainActivity"): Promise<void> {
    const result = await this.callTool("android-app", {
      serial,
      action: "start_app",
      package: appPackage,
      activity,
    });
    assertToolSuccess("android-app/start_app", result);
  }

  async stopApp(serial: string, appPackage: string): Promise<void> {
    const result = await this.callTool("android-app", {
      serial,
      action: "stop_app",
      package: appPackage,
    });
    assertToolSuccess("android-app/stop_app", result);
  }

  async tap(serial: string, x: number, y: number): Promise<void> {
    const result = await this.callTool("android-ui", {
      serial,
      action: "tap",
      x,
      y,
    });
    assertToolSuccess("android-ui/tap", result);
  }

  async swipe(
    serial: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs: number = 250,
  ): Promise<void> {
    const result = await this.callTool("android-ui", {
      serial,
      action: "swipe",
      start_x: startX,
      start_y: startY,
      end_x: endX,
      end_y: endY,
      duration_ms: durationMs,
    });
    assertToolSuccess("android-ui/swipe", result);
  }

  async pressKey(serial: string, keycode: number): Promise<void> {
    const result = await this.callTool("android-ui", {
      serial,
      action: "press_key",
      keycode,
    });
    assertToolSuccess("android-ui/press_key", result);
  }

  async inputText(serial: string, text: string): Promise<void> {
    const result = await this.callTool("android-ui", {
      serial,
      action: "input_text",
      text,
    });
    assertToolSuccess("android-ui/input_text", result);
  }

  async shell(serial: string, command: string, maxLines?: number, maxSize?: number): Promise<string> {
    const result = await this.callTool("android-shell", {
      serial,
      command,
      max_lines: maxLines,
      max_size: maxSize,
    });
    assertToolSuccess("android-shell", result);
    return unwrapCommandText(firstTextContent(result));
  }

  async screenshotToFile(serial: string, localPath: string): Promise<void> {
    const result = await this.callTool("android-screenshot", { serial });
    assertToolSuccess("android-screenshot", result);

    if (!hasContent(result)) {
      throw new Error("android-screenshot returned compatibility payload without image content.");
    }

    const imageItem = result.content.find(
      (item): item is { type: "image"; data: string; mimeType: string } =>
        item.type === "image" && typeof (item as { data?: unknown }).data === "string",
    );
    if (!imageItem) {
      throw new Error("android-screenshot did not return image data.");
    }
    const imageBuffer = Buffer.from(imageItem.data, "base64");
    await writeFile(localPath, imageBuffer);
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<ClientCallToolResult> {
    await this.connect();
    return this.client.callTool(
      {
        name,
        arguments: args,
      },
      CallToolResultSchema,
    );
  }
}
