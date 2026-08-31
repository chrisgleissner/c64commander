/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { checkCapabilities, type CapabilityCheckResult, type McpToolCapability } from "../cta/capabilities.js";
import { getScreenSize, nodeFragments } from "../cta/uiHelpers.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const DEFAULT_DROIDCTL_COMMAND = process.env["DROIDCTL_COMMAND"] ?? "node";
const DEFAULT_DROIDCTL_ARGS = process.env["DROIDCTL_ARGS"]?.trim()
  ? process.env["DROIDCTL_ARGS"]!.split(/\s+/)
  : [path.join(repositoryRoot, "droidctl/scripts/start.mjs")];

// Generous: real calls finish well under a second, but droidctl's own capture
// deadline is 30s, so this must not fire first and mask a structured error.
const MCP_CALL_TIMEOUT_MS = 45_000;

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

interface DroidctlEnvelope {
  ok: boolean;
  runId?: string;
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

function parseEnvelope(toolName: string, result: ClientCallToolResult): Record<string, unknown> {
  const text = firstTextContent(result);
  let envelope: DroidctlEnvelope;
  try {
    envelope = JSON.parse(text) as DroidctlEnvelope;
  } catch {
    throw new Error(`${toolName} returned a non-JSON payload: ${JSON.stringify(text.slice(0, 200))}`);
  }
  if (!envelope.ok) {
    const error = envelope.error ?? {};
    throw new Error(`${toolName} failed [${error.code ?? "unknown"}]: ${error.message ?? "no message"}`);
  }
  return envelope.data ?? {};
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

/**
 * Speaks to the in-repo droidctl MCP server. Method signatures still take a
 * serial, which is resolved to droidctl's opaque target id through
 * droid_target.list_targets: a serial that is not connected is an error here
 * rather than a call against whatever else is attached.
 */
export class DroidctlClient {
  private readonly client: Client;
  private readonly transport: StdioClientTransport;
  private connected = false;
  private readonly targetIds = new Map<string, string>();

  constructor(command: string = DEFAULT_DROIDCTL_COMMAND, args: readonly string[] = DEFAULT_DROIDCTL_ARGS) {
    this.client = new Client({ name: "c64scope-droidctl-client", version: "0.1.0" }, { capabilities: {} });
    this.transport = new StdioClientTransport({ command, args: [...args] });
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

  async listTools(): Promise<McpToolCapability[]> {
    await this.connect();
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      inputSchema: { properties: tool.inputSchema.properties },
    }));
  }

  async checkCapabilities(): Promise<CapabilityCheckResult> {
    return checkCapabilities(await this.listTools());
  }

  async listDevices(): Promise<string> {
    const data = await this.call("droid_target.list_targets", {});
    return JSON.stringify(data.targets ?? []);
  }

  /** Resolves a serial to droidctl's target id, refusing to guess when it is absent. */
  async resolveTargetId(serial: string): Promise<string> {
    const cached = this.targetIds.get(serial);
    if (cached) {
      return cached;
    }
    const data = await this.call("droid_target.list_targets", {});
    const targets = (data.targets ?? []) as { targetId: string; serial: string }[];
    const matches = targets.filter((target) => target.serial === serial);
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one connected target with serial ${serial}, found ${matches.length}. ` +
          `Connected: ${targets.map((target) => `${target.targetId}`).join(", ") || "none"}`,
      );
    }
    const targetId = matches[0]!.targetId;
    this.targetIds.set(serial, targetId);
    return targetId;
  }

  async startApp(serial: string, appPackage: string, activity: string = ".MainActivity"): Promise<void> {
    await this.call("droid_app.start_app", {
      targetId: await this.resolveTargetId(serial),
      package: appPackage,
      activity,
    });
  }

  async stopApp(serial: string, appPackage: string): Promise<void> {
    await this.call("droid_app.stop_app", {
      targetId: await this.resolveTargetId(serial),
      package: appPackage,
    });
  }

  async tap(serial: string, x: number, y: number): Promise<void> {
    await this.call("droid_input.tap", { targetId: await this.resolveTargetId(serial), x, y });
  }

  async swipe(
    serial: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs: number = 250,
  ): Promise<void> {
    await this.call("droid_input.swipe", {
      targetId: await this.resolveTargetId(serial),
      x1: startX,
      y1: startY,
      x2: endX,
      y2: endY,
      durationMs,
    });
  }

  /**
   * UI-walking policy, not a device operation, so it stays here rather than
   * moving into droidctl: swipe once and compare hierarchy keys to decide
   * whether the list moved at all.
   */
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
    await this.call("droid_input.press_key", { targetId: await this.resolveTargetId(serial), keycode });
  }

  async inputText(serial: string, text: string): Promise<void> {
    await this.call("droid_input.input_text", { targetId: await this.resolveTargetId(serial), text });
  }

  /**
   * `command` is a shell line, so it runs through `sh -c`. droidctl's run_shell
   * takes an argument vector and never builds a line by concatenation; wrapping
   * here keeps the pipes and redirections the existing call sites rely on.
   */
  async shell(serial: string, command: string, _maxLines?: number, maxSize?: number): Promise<string> {
    const data = await this.call("droid_device.run_shell", {
      targetId: await this.resolveTargetId(serial),
      command: ["sh", "-c", command],
      ...(maxSize === undefined ? {} : { maxBytes: maxSize }),
    });
    return String(data.stdout ?? "").trim();
  }

  /** droidctl owns the settle poll, the retry budget and the per-call deadline. */
  async captureUiHierarchy(serial: string): Promise<string> {
    const data = await this.call("droid_capture.ui_hierarchy", {
      targetId: await this.resolveTargetId(serial),
      name: `cta-${Date.now()}`,
    });
    const xmlPath = String(data.xmlPath ?? "");
    if (!xmlPath) {
      throw new Error("droid_capture.ui_hierarchy returned no xmlPath.");
    }
    return readFile(xmlPath, "utf-8");
  }

  async screenshotToFile(serial: string, localPath: string): Promise<void> {
    const parsed = path.parse(localPath);
    const data = await this.call("droid_capture.screenshot", {
      targetId: await this.resolveTargetId(serial),
      name: parsed.name,
      runRoot: parsed.dir,
    });
    const rawPath = String(data.rawPath ?? "");
    if (!rawPath) {
      throw new Error("droid_capture.screenshot returned no rawPath.");
    }
    await mkdir(parsed.dir, { recursive: true });
    if (path.resolve(rawPath) !== path.resolve(localPath)) {
      await copyFile(rawPath, localPath);
    }
  }

  private async call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.connect();
    const result = await this.client.callTool({ name, arguments: args }, CallToolResultSchema, {
      timeout: MCP_CALL_TIMEOUT_MS,
    });
    return parseEnvelope(name, result);
  }
}
