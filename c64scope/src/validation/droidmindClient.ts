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
import { checkCapabilities, type CapabilityCheckResult, type McpToolCapability } from "../cta/capabilities.js";
import { getScreenSize, nodeFragments } from "../cta/uiHelpers.js";

const DEFAULT_DROIDMIND_COMMAND = process.env["DROIDMIND_COMMAND"] ?? "uvx";
const DEFAULT_DROIDMIND_ARGS = process.env["DROIDMIND_ARGS"]?.trim()
  ? process.env["DROIDMIND_ARGS"]!.split(/\s+/)
  : ["--from", "git+https://github.com/hyperb1iss/droidmind", "droidmind", "--transport", "stdio"];
const UI_DUMP_DEVICE_PATH = "/sdcard/Download/c64scope-droidmind-ui.xml";
const UI_HIERARCHY_CAPTURE_ATTEMPTS = 3;
const UI_HIERARCHY_SETTLE_TIMEOUT_MS = 1500;
// Hard deadline for any single DroidMind MCP call. Generous (real calls finish
// in well under a second) so it never trips a slow-but-working call, but bounds
// a genuine hang — e.g. a wedged `uiautomator dump` that otherwise blocked the
// Gate 6 runner for >5 min (INFRA-003).
const MCP_CALL_TIMEOUT_MS = 30_000;
const UI_HIERARCHY_SETTLE_POLL_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function hierarchyKeys(xml: string): string[] {
  return nodeFragments(xml)
    .filter((fragment) => fragment.includes("bounds="))
    .map((fragment) => {
      const resourceId = fragment.match(/resource-id="([^"]*)"/)?.[1] ?? "";
      const text = fragment.match(/text="([^"]*)"/)?.[1] ?? "";
      const contentDesc = fragment.match(/content-desc="([^"]*)"/)?.[1] ?? "";
      const className = fragment.match(/class="([^"]*)"/)?.[1] ?? "";
      const bounds = fragment.match(/bounds="([^"]*)"/)?.[1] ?? "";
      return `${resourceId}|${text}|${contentDesc}|${className}|${bounds}`;
    })
    .sort();
}

function sameHierarchyKeys(before: string, after: string): boolean {
  const beforeKeys = hierarchyKeys(before);
  const afterKeys = hierarchyKeys(after);
  return beforeKeys.length === afterKeys.length && beforeKeys.every((key, index) => key === afterKeys[index]);
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

  async listTools(): Promise<McpToolCapability[]> {
    await this.connect();
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      inputSchema: {
        properties: tool.inputSchema.properties,
      },
    }));
  }

  async checkCapabilities(): Promise<CapabilityCheckResult> {
    return checkCapabilities(await this.listTools());
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

  async scrollDown(serial: string): Promise<{ atEnd: boolean }> {
    const before = await this.captureUiHierarchy(serial);
    const { width, height } = getScreenSize(before);
    const x = Math.round(width / 2);
    const startY = Math.round(height * 0.75);
    const endY = Math.round(height * 0.285);
    await this.swipe(serial, x, startY, x, endY, 300);
    await delay(250);
    const after = await this.captureUiHierarchy(serial);
    return { atEnd: sameHierarchyKeys(before, after) };
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

  async captureUiHierarchy(serial: string): Promise<string> {
    let lastOutput = "";
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= UI_HIERARCHY_CAPTURE_ATTEMPTS; attempt += 1) {
      try {
        await this.shell(serial, `rm -f ${UI_DUMP_DEVICE_PATH}`);
        await this.shell(serial, `uiautomator dump ${UI_DUMP_DEVICE_PATH}`);
        await this.waitForUiDumpToSettle(serial);
        const xml = await this.shell(serial, `cat ${UI_DUMP_DEVICE_PATH}`);
        if (xml.includes("<hierarchy")) {
          return xml;
        }
        lastOutput = xml;
      } catch (error) {
        // A single shell call (e.g. a wedged `uiautomator dump`) now fails fast
        // via the MCP call timeout instead of hanging forever (INFRA-003); retry
        // the whole capture rather than aborting on a transient device stall.
        lastError = error;
      }
      if (attempt < UI_HIERARCHY_CAPTURE_ATTEMPTS) {
        await delay(500);
      }
    }
    if (lastError) {
      throw new Error(
        `DroidMind UI hierarchy capture failed after ${UI_HIERARCHY_CAPTURE_ATTEMPTS} attempts: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
      );
    }
    throw new Error(
      `DroidMind UI hierarchy capture did not produce XML hierarchy content (bytes=${lastOutput.length}, excerpt=${JSON.stringify(lastOutput.slice(0, 160))}).`,
    );
  }

  private async waitForUiDumpToSettle(serial: string): Promise<void> {
    const deadline = Date.now() + UI_HIERARCHY_SETTLE_TIMEOUT_MS;
    let previousSize: number | null = null;

    while (Date.now() < deadline) {
      const output = await this.shell(
        serial,
        `sh -c 'if [ -f ${UI_DUMP_DEVICE_PATH} ]; then wc -c < ${UI_DUMP_DEVICE_PATH}; else echo 0; fi'`,
      );
      const size = Number.parseInt(output.trim(), 10);
      if (Number.isFinite(size) && size > 0 && previousSize === size) {
        return;
      }
      previousSize = Number.isFinite(size) ? size : null;
      await delay(UI_HIERARCHY_SETTLE_POLL_MS);
    }

    throw new Error(`Timed out waiting for stable UI hierarchy dump at ${UI_DUMP_DEVICE_PATH}.`);
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
    // Hard per-call deadline: a hung DroidMind call (observed: `uiautomator dump`
    // blocking forever) must not hang the whole gate runner indefinitely
    // (INFRA-003). The SDK rejects the request when the deadline elapses, which
    // lets retry/recovery logic (e.g. captureUiHierarchy's loop) take over.
    return this.client.callTool(
      {
        name,
        arguments: args,
      },
      CallToolResultSchema,
      { timeout: MCP_CALL_TIMEOUT_MS },
    );
  }
}
