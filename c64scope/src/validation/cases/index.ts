import type { ValidationCase } from "../types.js";
import { connDiagnostics, connStatus, navRouteShell } from "./navigation.js";
import { playSourceBrowse, playTransport } from "./playback.js";
import { configBrowse, diskBrowse, diskDriveConfig } from "./storage.js";
import { deliberateFailure, docsReadOnly, homeVisibility, settingsDiagnostics } from "./system.js";

export { connDiagnostics, connStatus, navRouteShell } from "./navigation.js";
export { playSourceBrowse, playTransport } from "./playback.js";
export { configBrowse, diskBrowse, diskDriveConfig } from "./storage.js";
export { deliberateFailure, docsReadOnly, homeVisibility, settingsDiagnostics } from "./system.js";

export const ALL_CASES: ValidationCase[] = [
    navRouteShell, // NAV-001 Navigation
    connStatus, // CONN-001 Connection
    connDiagnostics, // CONN-002 Connection
    playSourceBrowse, // PLAY-001 Play
    playTransport, // PLAY-002 Play
    diskBrowse, // DISK-001 Disks
    diskDriveConfig, // DISK-002 Disks
    configBrowse, // CFG-001 Config
    settingsDiagnostics, // SETTINGS-001 Settings
    homeVisibility, // HOME-001 Home
    deliberateFailure, // FAIL-001 Failure
    docsReadOnly, // DOCS-001 Docs
];
