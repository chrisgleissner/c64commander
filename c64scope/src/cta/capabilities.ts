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

export const requiredDroidctlCapabilities: readonly CapabilityRequirement[] = [
  { id: "device-list", toolName: "droid_target.list_targets" },
  { id: "app-start", toolName: "droid_app.start_app" },
  { id: "app-stop", toolName: "droid_app.stop_app" },
  { id: "ui-tap", toolName: "droid_input.tap" },
  { id: "ui-swipe", toolName: "droid_input.swipe" },
  { id: "ui-key", toolName: "droid_input.press_key" },
  { id: "ui-text", toolName: "droid_input.input_text" },
  { id: "shell-read", toolName: "droid_device.run_shell" },
  { id: "ui-hierarchy", toolName: "droid_capture.ui_hierarchy" },
  { id: "screenshot", toolName: "droid_capture.screenshot" },
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
  requirements: readonly CapabilityRequirement[] = requiredDroidctlCapabilities,
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
