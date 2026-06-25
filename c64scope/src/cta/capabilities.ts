/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface McpToolCapability {
  name: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
  };
}

export interface CapabilityRequirement {
  id: string;
  toolName: string;
  action?: string;
}

export interface CapabilityCheckResult {
  satisfied: boolean;
  missing: CapabilityRequirement[];
}

export const requiredDroidmindCapabilities: readonly CapabilityRequirement[] = [
  { id: "device-list", toolName: "android-device", action: "list_devices" },
  { id: "app-start", toolName: "android-app", action: "start_app" },
  { id: "app-stop", toolName: "android-app", action: "stop_app" },
  { id: "ui-tap", toolName: "android-ui", action: "tap" },
  { id: "ui-swipe", toolName: "android-ui", action: "swipe" },
  { id: "ui-key", toolName: "android-ui", action: "press_key" },
  { id: "ui-text", toolName: "android-ui", action: "input_text" },
  { id: "shell-read", toolName: "android-shell" },
  { id: "screenshot", toolName: "android-screenshot" },
];

function toolActions(tool: McpToolCapability): Set<string> | null {
  const actionProperty = tool.inputSchema?.properties?.["action"];
  if (!actionProperty || typeof actionProperty !== "object") {
    return null;
  }
  const enumValues = (actionProperty as { enum?: unknown }).enum;
  if (!Array.isArray(enumValues)) {
    return null;
  }
  return new Set(enumValues.filter((value): value is string => typeof value === "string"));
}

export function checkCapabilities(
  tools: readonly McpToolCapability[],
  requirements: readonly CapabilityRequirement[] = requiredDroidmindCapabilities,
): CapabilityCheckResult {
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const missing = requirements.filter((requirement) => {
    const tool = toolByName.get(requirement.toolName);
    if (!tool) {
      return true;
    }
    if (!requirement.action) {
      return false;
    }
    const actions = toolActions(tool);
    return actions !== null && !actions.has(requirement.action);
  });
  return { satisfied: missing.length === 0, missing };
}
