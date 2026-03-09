/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type { CaseContext, CaseResult, ExplorationTrace, RunResult, ValidationCase } from "./types.js";
export {
  adb,
  c64uFtpList,
  c64uGet,
  captureLogcat,
  isAppInForeground,
  launchApp,
  readC64Memory,
  resetC64Machine,
  runPrgOnC64u,
  takeScreenshot,
  ts,
} from "./helpers.js";
export {
  ALL_CASES,
  configBrowse,
  connDiagnostics,
  connStatus,
  deliberateFailure,
  diskBrowse,
  diskDriveConfig,
  docsReadOnly,
  homeVisibility,
  navRouteShell,
  playSourceBrowse,
  playTransport,
  settingsDiagnostics,
} from "./cases/index.js";
export { collectHardwareInfo, runCase } from "./runner.js";
export { generateReport } from "./report.js";
