/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ValidationCase } from "../types.js";
import {
  appFirstConfigSurface,
  appFirstDisksSurface,
  appFirstHomeSurface,
  appFirstLaunchShell,
  appFirstPlaybackContinuity,
  appFirstPlaylistAutoAdvance,
  appFirstPlaySurface,
  appFirstRuntimeRecovery,
  appFirstSettingsSurface,
  appFirstTabNavigation,
} from "./appFirst.js";
import { connDiagnostics, connStatus, navRouteShell } from "./navigation.js";
import { playSourceBrowse, playStreamSignals, playTransport } from "./playback.js";
import { configBrowse, diskBrowse, diskDriveConfig } from "./storage.js";
import { deliberateFailure, docsReadOnly, homeVisibility, settingsDiagnostics } from "./system.js";

export {
  appFirstConfigSurface,
  appFirstDisksSurface,
  appFirstHomeSurface,
  appFirstLaunchShell,
  appFirstPlaybackContinuity,
  appFirstPlaylistAutoAdvance,
  appFirstPlaySurface,
  appFirstRuntimeRecovery,
  appFirstSettingsSurface,
  appFirstTabNavigation,
} from "./appFirst.js";
export { connDiagnostics, connStatus, navRouteShell } from "./navigation.js";
export { playSourceBrowse, playStreamSignals, playTransport } from "./playback.js";
export { configBrowse, diskBrowse, diskDriveConfig } from "./storage.js";
export { deliberateFailure, docsReadOnly, homeVisibility, settingsDiagnostics } from "./system.js";

export const ALL_CASES: ValidationCase[] = [
  appFirstLaunchShell, // AF-001 Product app-first
  appFirstTabNavigation, // AF-002 Product app-first
  appFirstRuntimeRecovery, // AF-003 Product app-first
  appFirstHomeSurface, // AF-004 Product app-first
  appFirstDisksSurface, // AF-005 Product app-first
  appFirstPlaySurface, // AF-006 Product app-first
  appFirstConfigSurface, // AF-007 Product app-first
  appFirstSettingsSurface, // AF-008 Product app-first
  appFirstPlaybackContinuity, // AF-009 Product app-first
  appFirstPlaylistAutoAdvance, // AF-010 Product app-first
  navRouteShell, // NAV-001 Navigation
  connStatus, // CONN-001 Connection
  connDiagnostics, // CONN-002 Connection
  playSourceBrowse, // PLAY-001 Play
  playTransport, // PLAY-002 Play
  playStreamSignals, // PLAY-003 Play
  diskBrowse, // DISK-001 Disks
  diskDriveConfig, // DISK-002 Disks
  configBrowse, // CFG-001 Config
  settingsDiagnostics, // SETTINGS-001 Settings
  homeVisibility, // HOME-001 Home
  deliberateFailure, // FAIL-001 Failure
  docsReadOnly, // DOCS-001 Docs
];
