/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface AgenticControllerScrollResult {
  atEnd: boolean;
}

export interface AgenticController {
  captureUiHierarchy(serial: string): Promise<string>;
  scrollDown(serial: string): Promise<AgenticControllerScrollResult>;
}
