/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** The one tool that runs without a target, because it is what issues target ids. */
export const TARGETLESS_TOOLS: readonly string[] = ["droid_target.list_targets"];

export function requiresTarget(toolName: string): boolean {
  return !TARGETLESS_TOOLS.includes(toolName);
}

/**
 * Tools that act on one named application. Both application ids can be installed
 * at once and both open a WebView DevTools socket, so the package is never
 * defaulted (spec §6.3 rule 7).
 */
export function isApplicationScoped(toolName: string): boolean {
  return toolName.startsWith("droid_app.") || toolName === "droid_device.forward_webview";
}
