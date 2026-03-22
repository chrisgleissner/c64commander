/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Page } from "@playwright/test";
import type { TraceEvent } from "../src/lib/tracing/types";
import type { HealthCheckRunResult } from "../src/lib/diagnostics/healthCheckEngine";
import { buildPayloadPreviewFromBytes, buildPayloadPreviewFromJson } from "../src/lib/tracing/payloadPreview";

export const FIXED_NOW_ISO = "2024-03-20T12:34:56.000Z";
export const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);

export const DISK_LIBRARY_SEED = [
  {
    id: "ultimate:/Usb0/Games/Turrican II/Disk 1.d64",
    name: "Disk 1.d64",
    path: "/Usb0/Games/Turrican II/Disk 1.d64",
    location: "ultimate",
    group: "Turrican II",
    sizeBytes: 174848,
    modifiedAt: "2024-03-10T10:00:00.000Z",
    importedAt: "2024-03-12T09:00:00.000Z",
    importOrder: 1,
  },
  {
    id: "ultimate:/Usb0/Games/Turrican II/Disk 2.d64",
    name: "Disk 2.d64",
    path: "/Usb0/Games/Turrican II/Disk 2.d64",
    location: "ultimate",
    group: "Turrican II",
    sizeBytes: 174848,
    modifiedAt: "2024-03-10T10:05:00.000Z",
    importedAt: "2024-03-12T09:01:00.000Z",
    importOrder: 2,
  },
  {
    id: "ultimate:/Usb0/Games/Turrican II/Disk 3.d64",
    name: "Disk 3.d64",
    path: "/Usb0/Games/Turrican II/Disk 3.d64",
    location: "ultimate",
    group: "Turrican II",
    sizeBytes: 174848,
    modifiedAt: "2024-03-10T10:10:00.000Z",
    importedAt: "2024-03-12T09:02:00.000Z",
    importOrder: 3,
  },
  {
    id: "ultimate:/Usb0/Games/Last Ninja/Disk 1.d64",
    name: "Disk 1.d64",
    path: "/Usb0/Games/Last Ninja/Disk 1.d64",
    location: "ultimate",
    group: "Last Ninja",
    sizeBytes: 174848,
    modifiedAt: "2024-03-11T08:15:00.000Z",
    importedAt: "2024-03-12T09:03:00.000Z",
    importOrder: 1,
  },
  {
    id: "local:/Local/Disks/Defender of the Crown.d64",
    name: "Defender of the Crown.d64",
    path: "/Local/Disks/Defender of the Crown.d64",
    location: "local",
    group: null,
    sizeBytes: 174848,
    modifiedAt: "2024-03-11T09:00:00.000Z",
    importedAt: "2024-03-12T09:04:00.000Z",
    importOrder: 4,
  },
  {
    id: "local:/Local/Disks/Great Giana Sisters.d64",
    name: "Great Giana Sisters.d64",
    path: "/Local/Disks/Great Giana Sisters.d64",
    location: "local",
    group: null,
    sizeBytes: 174848,
    modifiedAt: "2024-03-11T09:30:00.000Z",
    importedAt: "2024-03-12T09:05:00.000Z",
    importOrder: 5,
  },
];

export const PLAYLIST_SEED = {
  items: [
    {
      source: "local",
      path: "/Local/Demos/intro.sid",
      name: "intro.sid",
      durationMs: 185000,
      sizeBytes: 32145,
      modifiedAt: "2024-03-18T09:12:00.000Z",
      addedAt: "2024-03-18T09:30:00.000Z",
    },
    {
      source: "local",
      path: "/Local/Demos/scene.mod",
      name: "scene.mod",
      durationMs: 210000,
      sizeBytes: 54231,
      modifiedAt: "2024-03-18T10:15:00.000Z",
      addedAt: "2024-03-18T10:20:00.000Z",
    },
    {
      source: "local",
      path: "/Local/Tools/fastload.prg",
      name: "fastload.prg",
      durationMs: 60000,
      sizeBytes: 1048,
      modifiedAt: "2024-03-18T11:00:00.000Z",
      addedAt: "2024-03-18T11:05:00.000Z",
    },
    {
      source: "ultimate",
      path: "/Usb0/Games/SpaceTaxi.d64",
      name: "SpaceTaxi.d64",
      durationMs: 300000,
      sizeBytes: 174848,
      modifiedAt: "2024-03-19T08:05:00.000Z",
      addedAt: "2024-03-19T08:10:00.000Z",
    },
    {
      source: "ultimate",
      path: "/Usb0/Cartridges/ActionReplay.crt",
      name: "ActionReplay.crt",
      durationMs: 120000,
      sizeBytes: 65536,
      modifiedAt: "2024-03-19T09:00:00.000Z",
      addedAt: "2024-03-19T09:05:00.000Z",
    },
  ],
  currentIndex: 1,
};

export const LOG_SEED = [
  {
    id: "log-debug-cache-warmup",
    level: "debug",
    message: "Cache warmup finished",
    timestamp: "2024-03-20T12:17:20.000Z",
    details: { cache: "source-index", entries: 42, durationMs: 36 },
  },
  {
    id: "log-info-config-refresh",
    level: "info",
    message: "REST config refresh completed",
    timestamp: "2024-03-20T12:18:10.000Z",
    details: { endpoint: "/v1/configs", durationMs: 180 },
  },
  {
    id: "log-warn-circadian",
    level: "warn",
    message: "Lighting Studio circadian resolution failed",
    timestamp: "2024-03-20T12:19:10.000Z",
    details: {
      profile: "sunrise",
      fallback: "static palette",
      error: {
        name: "RangeError",
        message: "invalid sunrise offset",
        stack:
          "RangeError: invalid sunrise offset\n    at resolveCircadianPalette (src/hooks/useLightingStudio.ts:395:13)\n    at applyCircadianPreset (src/hooks/useLightingStudio.ts:500:9)\n    at async saveLightingProfile (src/hooks/useLightingStudio.ts:518:7)",
      },
      errorName: "RangeError",
      errorStack:
        "RangeError: invalid sunrise offset\n    at resolveCircadianPalette (src/hooks/useLightingStudio.ts:395:13)\n    at applyCircadianPreset (src/hooks/useLightingStudio.ts:500:9)\n    at async saveLightingProfile (src/hooks/useLightingStudio.ts:518:7)",
    },
  },
  {
    id: "log-error-disk-import",
    level: "error",
    message: "FTP disk import failed",
    timestamp: "2024-03-20T12:20:05.000Z",
    details: {
      path: "/Usb0/Games/Corrupt.d64",
      code: "E_FTP_IMPORT",
      error: {
        name: "FtpDiskImportError",
        message: "550 Corrupt disk image",
        stack:
          "FtpDiskImportError: 550 Corrupt disk image\n    at importDisk (src/lib/disks/ftpDiskImport.ts:75:11)\n    at async loadDisk (src/components/disks/HomeDiskManager.tsx:860:19)\n    at async onSelectDisk (src/components/disks/HomeDiskManager.tsx:908:17)\n    at async HTMLButtonElement.handleImportClick (src/components/disks/HomeDiskManager.tsx:940:13)",
      },
      errorName: "FtpDiskImportError",
      errorStack:
        "FtpDiskImportError: 550 Corrupt disk image\n    at importDisk (src/lib/disks/ftpDiskImport.ts:75:11)\n    at async loadDisk (src/components/disks/HomeDiskManager.tsx:860:19)\n    at async onSelectDisk (src/components/disks/HomeDiskManager.tsx:908:17)\n    at async HTMLButtonElement.handleImportClick (src/components/disks/HomeDiskManager.tsx:940:13)",
    },
  },
];

const isoMinutesAgo = (minutesAgo: number, offsetMs = 0) =>
  new Date(FIXED_NOW_MS - minutesAgo * 60_000 + offsetMs).toISOString();

type SeedScenario = {
  minutesAgo: number;
  actionName: string;
  origin: "system" | "user";
  rest: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
    error: string | null;
    requestHeaders?: Record<string, string | string[]>;
    requestBody?: unknown;
    requestPayloadPreview?: ReturnType<typeof buildPayloadPreviewFromJson>;
    responseHeaders?: Record<string, string | string[]>;
    responseBody?: unknown;
    responsePayloadPreview?: ReturnType<typeof buildPayloadPreviewFromJson>;
  };
  ftp?: {
    operation: string;
    path: string;
    durationMs: number;
    result: "success" | "failure";
    error: string | null;
    requestPayload?: unknown;
    requestPayloadPreview?: ReturnType<typeof buildPayloadPreviewFromJson>;
    responsePayload?: unknown;
    responsePayloadPreview?: ReturnType<typeof buildPayloadPreviewFromBytes>;
  };
  errorMessage?: string;
};

const createRestScenario = ({
  minutesAgo,
  actionName,
  origin = "system",
  method = "GET",
  path,
  status = 200,
  durationMs,
  error = null,
  requestHeaders,
  requestBody,
  requestPayloadPreview,
  responseHeaders,
  responseBody,
  responsePayloadPreview,
  errorMessage,
}: {
  minutesAgo: number;
  actionName: string;
  origin?: SeedScenario["origin"];
  method?: string;
  path: string;
  status?: number;
  durationMs: number;
  error?: string | null;
  requestHeaders?: SeedScenario["rest"]["requestHeaders"];
  requestBody?: SeedScenario["rest"]["requestBody"];
  requestPayloadPreview?: SeedScenario["rest"]["requestPayloadPreview"];
  responseHeaders?: SeedScenario["rest"]["responseHeaders"];
  responseBody?: SeedScenario["rest"]["responseBody"];
  responsePayloadPreview?: SeedScenario["rest"]["responsePayloadPreview"];
  errorMessage?: string;
}): SeedScenario => ({
  minutesAgo,
  actionName,
  origin,
  rest: {
    method,
    path,
    status,
    durationMs,
    error,
    ...(requestHeaders ? { requestHeaders } : {}),
    ...(requestBody !== undefined ? { requestBody } : {}),
    ...(requestPayloadPreview ? { requestPayloadPreview } : {}),
    ...(responseHeaders ? { responseHeaders } : {}),
    ...(responseBody !== undefined ? { responseBody } : {}),
    ...(responsePayloadPreview ? { responsePayloadPreview } : {}),
  },
  errorMessage,
});

const createFtpScenario = ({
  minutesAgo,
  actionName,
  restPath,
  restMethod = "GET",
  restStatus = 200,
  restDurationMs,
  restError = null,
  ftpOperation,
  ftpPath,
  ftpDurationMs,
  ftpResult = "success",
  ftpError = null,
  ftpRequestPayload,
  ftpRequestPayloadPreview,
  ftpResponsePayload,
  ftpResponsePayloadPreview,
  errorMessage,
}: {
  minutesAgo: number;
  actionName: string;
  restPath: string;
  restMethod?: string;
  restStatus?: number;
  restDurationMs: number;
  restError?: string | null;
  ftpOperation: string;
  ftpPath: string;
  ftpDurationMs: number;
  ftpResult?: "success" | "failure";
  ftpError?: string | null;
  ftpRequestPayload?: SeedScenario["ftp"]["requestPayload"];
  ftpRequestPayloadPreview?: SeedScenario["ftp"]["requestPayloadPreview"];
  ftpResponsePayload?: SeedScenario["ftp"]["responsePayload"];
  ftpResponsePayloadPreview?: SeedScenario["ftp"]["responsePayloadPreview"];
  errorMessage?: string;
}): SeedScenario => ({
  minutesAgo,
  actionName,
  origin: "user",
  rest: {
    method: restMethod,
    path: restPath,
    status: restStatus,
    durationMs: restDurationMs,
    error: restError,
  },
  ftp: {
    operation: ftpOperation,
    path: ftpPath,
    durationMs: ftpDurationMs,
    result: ftpResult,
    error: ftpError,
    ...(ftpRequestPayload !== undefined ? { requestPayload: ftpRequestPayload } : {}),
    ...(ftpRequestPayloadPreview ? { requestPayloadPreview: ftpRequestPayloadPreview } : {}),
    ...(ftpResponsePayload !== undefined ? { responsePayload: ftpResponsePayload } : {}),
    ...(ftpResponsePayloadPreview ? { responsePayloadPreview: ftpResponsePayloadPreview } : {}),
  },
  errorMessage,
});

const buildTraceSeed = (): TraceEvent[] => {
  const diagnosticsSnapshotRequestBody = {
    includeRawTraces: true,
    format: "zip",
  };
  const diagnosticsSnapshotResponseBody = {
    snapshotId: "snap-2024-03-20-123456",
  };
  const ftpSidBytes = Uint8Array.from({ length: 320 }, (_, index) => (index * 37) % 256);
  const scenarios: SeedScenario[] = [
    createRestScenario({ minutesAgo: 236, actionName: "connection.poll", path: "/v1/info", durationMs: 58 }),
    createRestScenario({ minutesAgo: 228, actionName: "config.tree.sync", path: "/v1/configs", durationMs: 188 }),
    createRestScenario({
      minutesAgo: 222,
      actionName: "config.audio.inspect",
      path: "/v1/configs/Audio/Volume",
      durationMs: 96,
    }),
    createRestScenario({
      minutesAgo: 216,
      actionName: "config.video.inspect",
      path: "/v1/configs/Video/Palette",
      durationMs: 112,
    }),
    createRestScenario({
      minutesAgo: 210,
      actionName: "config.network.inspect",
      path: "/v1/configs/Network/Host",
      durationMs: 108,
    }),
    createRestScenario({
      minutesAgo: 204,
      actionName: "config.drives.inspect",
      path: "/v1/configs/Drives/DefaultPath",
      durationMs: 121,
    }),
    createRestScenario({ minutesAgo: 198, actionName: "drive.inventory", path: "/v1/drives", durationMs: 132 }),
    createRestScenario({
      minutesAgo: 192,
      actionName: "drive.mount.8",
      origin: "user",
      method: "POST",
      path: "/v1/drives/8/mount",
      status: 500,
      durationMs: 348,
      error: "Drive 8 busy",
      errorMessage: "Drive 8 busy during mount",
    }),
    createRestScenario({
      minutesAgo: 186,
      actionName: "drive.eject.9",
      origin: "user",
      method: "POST",
      path: "/v1/drives/9/eject",
      durationMs: 226,
    }),
    createRestScenario({
      minutesAgo: 180,
      actionName: "machine.reset",
      origin: "user",
      method: "POST",
      path: "/v1/machine/reset",
      durationMs: 394,
    }),
    createRestScenario({
      minutesAgo: 174,
      actionName: "machine.power",
      origin: "user",
      method: "POST",
      path: "/v1/machine/power",
      durationMs: 356,
    }),
    createRestScenario({ minutesAgo: 168, actionName: "stream.status", path: "/v1/streams/status", durationMs: 82 }),
    createRestScenario({
      minutesAgo: 162,
      actionName: "runner.launch",
      origin: "user",
      method: "POST",
      path: "/v1/runners/script/launch",
      status: 504,
      durationMs: 288,
      error: "Runner timeout",
      errorMessage: "Script runner did not respond before timeout",
    }),
    createRestScenario({
      minutesAgo: 156,
      actionName: "diagnostics.export",
      origin: "user",
      method: "POST",
      path: "/v1/diagnostics/export",
      durationMs: 168,
    }),
    createRestScenario({
      minutesAgo: 150,
      actionName: "library.current",
      path: "/v1/playlists/current",
      durationMs: 88,
    }),
    createRestScenario({ minutesAgo: 144, actionName: "library.search", path: "/v1/files/search", durationMs: 126 }),
    createFtpScenario({
      minutesAgo: 138,
      actionName: "ftp.browse.games",
      restPath: "/v1/drives",
      restDurationMs: 116,
      ftpOperation: "LIST",
      ftpPath: "/Usb0/Games",
      ftpDurationMs: 164,
    }),
    createFtpScenario({
      minutesAgo: 132,
      actionName: "ftp.browse.config",
      restPath: "/v1/info",
      restDurationMs: 74,
      ftpOperation: "MLSD",
      ftpPath: "/Usb0/Config",
      ftpDurationMs: 152,
    }),
    createFtpScenario({
      minutesAgo: 126,
      actionName: "ftp.preview.prg",
      restPath: "/v1/playlists/current",
      restDurationMs: 92,
      ftpOperation: "RETR",
      ftpPath: "/Usb0/Games/Turrican_II/loader.prg",
      ftpDurationMs: 214,
    }),
    createFtpScenario({
      minutesAgo: 120,
      actionName: "ftp.preview.disk",
      restPath: "/v1/info",
      restDurationMs: 68,
      ftpOperation: "SIZE",
      ftpPath: "/Usb0/Games/Turrican II/Disk 1.d64",
      ftpDurationMs: 138,
    }),
    createFtpScenario({
      minutesAgo: 114,
      actionName: "ftp.write.config",
      restPath: "/v1/configs/Drives/DefaultPath",
      restMethod: "PUT",
      restDurationMs: 166,
      ftpOperation: "STOR",
      ftpPath: "/Usb0/Config/default-path.txt",
      ftpDurationMs: 248,
      ftpResult: "failure",
      ftpError: "Write protect",
      errorMessage: "Default path upload blocked by write protection",
    }),
    createFtpScenario({
      minutesAgo: 108,
      actionName: "ftp.write.logs",
      restPath: "/v1/diagnostics/export",
      restMethod: "POST",
      restDurationMs: 158,
      ftpOperation: "APPE",
      ftpPath: "/Usb0/Logs/diag.log",
      ftpDurationMs: 176,
    }),
    createFtpScenario({
      minutesAgo: 102,
      actionName: "ftp.manage.mkdir",
      restPath: "/v1/info",
      restDurationMs: 72,
      ftpOperation: "MKD",
      ftpPath: "/Usb0/Saves/Session",
      ftpDurationMs: 122,
    }),
    createFtpScenario({
      minutesAgo: 96,
      actionName: "ftp.manage.delete",
      restPath: "/v1/info",
      restDurationMs: 70,
      ftpOperation: "DELE",
      ftpPath: "/Usb0/Logs/old.log",
      ftpDurationMs: 144,
      ftpResult: "failure",
      ftpError: "Permission denied",
      errorMessage: "Old diagnostics log could not be removed",
    }),
    createFtpScenario({
      minutesAgo: 90,
      actionName: "ftp.manage.rename-from",
      restPath: "/v1/info",
      restDurationMs: 69,
      ftpOperation: "RNFR",
      ftpPath: "/Usb0/Saves/slot-old.sav",
      ftpDurationMs: 104,
    }),
    createFtpScenario({
      minutesAgo: 84,
      actionName: "ftp.manage.rename-to",
      restPath: "/v1/info",
      restDurationMs: 67,
      ftpOperation: "RNTO",
      ftpPath: "/Usb0/Saves/slot-new.sav",
      ftpDurationMs: 106,
    }),
    createFtpScenario({
      minutesAgo: 78,
      actionName: "ftp.session.cwd",
      restPath: "/v1/info",
      restDurationMs: 63,
      ftpOperation: "CWD",
      ftpPath: "/Usb0/Config",
      ftpDurationMs: 82,
    }),
    createFtpScenario({
      minutesAgo: 72,
      actionName: "ftp.session.pwd",
      restPath: "/v1/info",
      restDurationMs: 61,
      ftpOperation: "PWD",
      ftpPath: "/",
      ftpDurationMs: 56,
    }),
    createFtpScenario({
      minutesAgo: 66,
      actionName: "ftp.session.noop",
      restPath: "/v1/info",
      restDurationMs: 58,
      ftpOperation: "NOOP",
      ftpPath: "/",
      ftpDurationMs: 44,
    }),
    createRestScenario({
      minutesAgo: 60,
      actionName: "config.audio.write",
      origin: "user",
      method: "PUT",
      path: "/v1/configs/Audio/FilterBias",
      durationMs: 146,
    }),
    createRestScenario({
      minutesAgo: 54,
      actionName: "config.video.write",
      origin: "user",
      method: "PUT",
      path: "/v1/configs/Video/BorderColor",
      durationMs: 152,
    }),
    createRestScenario({
      minutesAgo: 48,
      actionName: "config.led.write",
      origin: "user",
      method: "PUT",
      path: "/v1/configs/LED%20Strip%20Settings/Brightness",
      durationMs: 178,
    }),
    createRestScenario({
      minutesAgo: 42,
      actionName: "config.peripherals.write",
      origin: "user",
      method: "PUT",
      path: "/v1/configs/Peripherals/JoystickPort",
      durationMs: 164,
    }),
    createRestScenario({
      minutesAgo: 36,
      actionName: "drive.status",
      path: "/v1/drives/8/status",
      durationMs: 118,
    }),
    createRestScenario({ minutesAgo: 30, actionName: "stream.latency", path: "/v1/streams/latency", durationMs: 86 }),
    createRestScenario({
      minutesAgo: 22,
      actionName: "runner.status",
      path: "/v1/runners/script/status",
      status: 503,
      durationMs: 132,
      error: "Script runner unavailable",
      errorMessage: "Script runner unavailable during diagnostics collection",
    }),
    createRestScenario({
      minutesAgo: 18,
      actionName: "diagnostics.snapshot",
      origin: "user",
      method: "POST",
      path: "/v1/diagnostics/snapshot",
      durationMs: 174,
      requestHeaders: {
        authorization: "Bea...[redacted]",
        "content-type": "application/json",
        "x-device-token": "c64...[redacted]",
      },
      requestBody: diagnosticsSnapshotRequestBody,
      responseHeaders: {
        "content-type": "application/json",
        "set-cookie": "SID=abc...[redacted]",
      },
      responseBody: diagnosticsSnapshotResponseBody,
    }),
    createFtpScenario({
      minutesAgo: 12,
      actionName: "ftp.browse.demos",
      restPath: "/v1/playlists/current",
      restDurationMs: 84,
      ftpOperation: "NLST",
      ftpPath: "/Usb0/Demos",
      ftpDurationMs: 132,
    }),
    createFtpScenario({
      minutesAgo: 8,
      actionName: "ftp.read.sid",
      restPath: "/v1/playlists/current",
      restDurationMs: 81,
      ftpOperation: "RETR",
      ftpPath: "/Usb0/Music/intro.sid",
      ftpDurationMs: 186,
      ftpRequestPayload: { host: "c64u", path: "/Usb0/Music/intro.sid" },
      ftpRequestPayloadPreview: buildPayloadPreviewFromJson({ host: "c64u", path: "/Usb0/Music/intro.sid" }),
      ftpResponsePayload: { sizeBytes: ftpSidBytes.byteLength, mimeType: "audio/prs.sid" },
      ftpResponsePayloadPreview: buildPayloadPreviewFromBytes(ftpSidBytes),
    }),
    createFtpScenario({
      minutesAgo: 4,
      actionName: "ftp.write.save",
      restPath: "/v1/configs/Drives/DefaultPath",
      restMethod: "PUT",
      restDurationMs: 168,
      ftpOperation: "STOR",
      ftpPath: "/Usb0/Saves/slot2.sav",
      ftpDurationMs: 202,
    }),
    createFtpScenario({
      minutesAgo: 2,
      actionName: "ftp.session.cwd.recent",
      restPath: "/v1/info",
      restDurationMs: 64,
      ftpOperation: "CWD",
      ftpPath: "/Usb0/Games",
      ftpDurationMs: 78,
    }),
    createRestScenario({
      minutesAgo: 1.2,
      actionName: "config.machine.write",
      origin: "user",
      method: "PUT",
      path: "/v1/configs/Machine/Region",
      durationMs: 142,
    }),
  ];

  const rawEvents: TraceEvent[] = [];
  let earliestTimestampMs = Number.POSITIVE_INFINITY;

  scenarios.forEach((scenario, index) => {
    const correlationId = `COR-${(index + 1).toString().padStart(4, "0")}`;
    const actionBase = `TRACE-${(index + 1).toString().padStart(4, "0")}`;
    const baseTimestampMs = FIXED_NOW_MS - scenario.minutesAgo * 60_000;
    earliestTimestampMs = Math.min(earliestTimestampMs, baseTimestampMs);

    rawEvents.push(
      {
        id: `${actionBase}-start`,
        timestamp: new Date(baseTimestampMs).toISOString(),
        relativeMs: 0,
        type: "action-start",
        origin: scenario.origin,
        correlationId,
        data: { name: scenario.actionName },
      },
      {
        id: `${actionBase}-rest-request`,
        timestamp: new Date(baseTimestampMs + 35).toISOString(),
        relativeMs: 35,
        type: "rest-request",
        origin: scenario.origin,
        correlationId,
        data: {
          method: scenario.rest.method,
          path: scenario.rest.path,
          url: scenario.rest.path,
          normalizedUrl: scenario.rest.path,
          headers: scenario.rest.requestHeaders ?? {},
          body: scenario.rest.requestBody ?? null,
          payloadPreview: scenario.rest.requestPayloadPreview ?? null,
          target: "real-device",
        },
      },
      {
        id: `${actionBase}-rest-response`,
        timestamp: new Date(baseTimestampMs + 35 + scenario.rest.durationMs).toISOString(),
        relativeMs: 35 + scenario.rest.durationMs,
        type: "rest-response",
        origin: scenario.origin,
        correlationId,
        data: {
          method: scenario.rest.method,
          path: scenario.rest.path,
          status: scenario.rest.status,
          headers: scenario.rest.responseHeaders ?? {},
          body: scenario.rest.responseBody ?? null,
          payloadPreview: scenario.rest.responsePayloadPreview ?? null,
          durationMs: scenario.rest.durationMs,
          error: scenario.rest.error,
        },
      },
    );

    if (scenario.ftp) {
      rawEvents.push({
        id: `${actionBase}-ftp`,
        timestamp: new Date(baseTimestampMs + 120 + scenario.ftp.durationMs).toISOString(),
        relativeMs: 120 + scenario.ftp.durationMs,
        type: "ftp-operation",
        origin: scenario.origin,
        correlationId,
        data: {
          operation: scenario.ftp.operation,
          path: scenario.ftp.path,
          durationMs: scenario.ftp.durationMs,
          result: scenario.ftp.result,
          requestPayload: scenario.ftp.requestPayload ?? null,
          requestPayloadPreview: scenario.ftp.requestPayloadPreview ?? null,
          responsePayload: scenario.ftp.responsePayload ?? null,
          responsePayloadPreview: scenario.ftp.responsePayloadPreview ?? null,
          error: scenario.ftp.error,
          target: "real-device",
        },
      });
    }

    if (scenario.errorMessage) {
      rawEvents.push({
        id: `${actionBase}-error`,
        timestamp: new Date(baseTimestampMs + 180).toISOString(),
        relativeMs: 180,
        type: "error",
        origin: scenario.origin,
        correlationId,
        data: { name: "Error", message: scenario.errorMessage },
      });
    }

    rawEvents.push({
      id: `${actionBase}-end`,
      timestamp: new Date(baseTimestampMs + 260).toISOString(),
      relativeMs: 260,
      type: "action-end",
      origin: scenario.origin,
      correlationId,
      data: {
        status: scenario.rest.status >= 400 || scenario.ftp?.result === "failure" ? "failure" : "success",
        error: scenario.rest.error ?? scenario.ftp?.error ?? null,
      },
    });
  });

  return rawEvents
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .map((event) => ({
      ...event,
      relativeMs: Date.parse(event.timestamp) - earliestTimestampMs,
    }));
};

const HEALTH_CHECK_RESULT_SEED: HealthCheckRunResult = {
  runId: "hc-seed-2024-03-20-123456",
  startTimestamp: isoMinutesAgo(7, 0),
  endTimestamp: isoMinutesAgo(7, 520),
  totalDurationMs: 520,
  overallHealth: "Healthy",
  probes: {
    REST: { probe: "REST", outcome: "Success", durationMs: 72, reason: null, startMs: FIXED_NOW_MS - 7 * 60_000 },
    FTP: {
      probe: "FTP",
      outcome: "Success",
      durationMs: 116,
      reason: null,
      startMs: FIXED_NOW_MS - 7 * 60_000 + 80,
    },
    CONFIG: {
      probe: "CONFIG",
      outcome: "Success",
      durationMs: 148,
      reason: null,
      startMs: FIXED_NOW_MS - 7 * 60_000 + 210,
    },
    RASTER: {
      probe: "RASTER",
      outcome: "Success",
      durationMs: 84,
      reason: null,
      startMs: FIXED_NOW_MS - 7 * 60_000 + 370,
    },
    JIFFY: {
      probe: "JIFFY",
      outcome: "Success",
      durationMs: 100,
      reason: null,
      startMs: FIXED_NOW_MS - 7 * 60_000 + 460,
    },
  },
  latency: { p50: 54, p90: 86, p99: 128 },
  deviceInfo: {
    firmware: "3.10b1",
    fpga: "1.42",
    core: "2024.03",
    uptimeSeconds: 14732,
    product: "C64 Ultimate",
  },
};

const HEALTH_HISTORY_SEED = Array.from({ length: 13 }, (_, index) => {
  const states = [
    "Healthy",
    "Healthy",
    "Degraded",
    "Unhealthy",
    "Degraded",
    "Healthy",
    "Healthy",
    "Degraded",
    "Healthy",
    "Healthy",
    "Degraded",
    "Healthy",
    "Healthy",
  ] as const;
  const state = states[index] ?? "Healthy";
  const minutesAgo = 240 - index * 20;
  const durationMs = 320 + index * 23;
  return {
    timestamp: isoMinutesAgo(minutesAgo),
    overallHealth: state,
    durationMs,
    probes: {
      rest: { outcome: state === "Unhealthy" ? "Fail" : "Success", durationMs: 54 + index * 2, reason: null },
      jiffy: { outcome: state === "Degraded" ? "Partial" : "Success", durationMs: 68 + index * 3, reason: null },
      raster: { outcome: "Skipped", durationMs: null, reason: "Unavailable in simulation" },
      config: { outcome: "Success", durationMs: 92 + index * 4, reason: null },
      ftp: {
        outcome: index === 3 || index === 7 ? "Fail" : "Success",
        durationMs: 125 + index * 5,
        reason: index === 3 || index === 7 ? "Command timeout" : null,
      },
    },
    latency: {
      p50: 46 + index * 3,
      p90: 88 + index * 5,
      p99: 140 + index * 8,
    },
  };
});

const LATENCY_SAMPLE_SEED = [
  { minutesAgo: 4.7, transport: "REST", path: "/v1/info", durationMs: 58 },
  { minutesAgo: 4.4, transport: "REST", path: "/v1/configs", durationMs: 212 },
  { minutesAgo: 4.1, transport: "FTP", path: "/", durationMs: 168 },
  { minutesAgo: 3.8, transport: "REST", path: "/v1/drives", durationMs: 124 },
  { minutesAgo: 3.5, transport: "REST", path: "/v1/configs/Audio/Volume", durationMs: 132 },
  { minutesAgo: 3.2, transport: "FTP", path: "/v1/ftp/read/Usb0/Games", durationMs: 226 },
  { minutesAgo: 2.9, transport: "REST", path: "/v1/machine/reset", durationMs: 402 },
  { minutesAgo: 2.6, transport: "REST", path: "/v1/info", durationMs: 61 },
  { minutesAgo: 2.3, transport: "FTP", path: "/", durationMs: 178 },
  { minutesAgo: 2.0, transport: "REST", path: "/v1/configs/Video/Palette", durationMs: 146 },
  { minutesAgo: 1.7, transport: "REST", path: "/v1/configs/Drives/DefaultPath", durationMs: 188 },
  { minutesAgo: 1.4, transport: "REST", path: "/v1/drives", durationMs: 138 },
  { minutesAgo: 1.1, transport: "FTP", path: "/v1/ftp/read/Usb0/Config", durationMs: 214 },
  { minutesAgo: 0.8, transport: "REST", path: "/v1/info", durationMs: 57 },
  { minutesAgo: 0.5, transport: "REST", path: "/v1/configs", durationMs: 198 },
  { minutesAgo: 0.2, transport: "REST", path: "/v1/machine/reset", durationMs: 365 },
] as const;

const RECOVERY_EVIDENCE_SEED = [
  {
    timestamp: isoMinutesAgo(175),
    kind: "retry-connection",
    outcome: "failure",
    contributor: "REST",
    target: "c64u",
    message: "Connection retry failed",
  },
  {
    timestamp: isoMinutesAgo(172),
    kind: "switch-device",
    outcome: "success",
    contributor: "REST",
    target: "c64u-backup",
    message: "Switched to c64u-backup",
  },
  {
    timestamp: isoMinutesAgo(118),
    kind: "health-check",
    outcome: "success",
    contributor: "App",
    target: "c64u-backup",
    message: "Health check Healthy",
  },
  {
    timestamp: isoMinutesAgo(64),
    kind: "retry-connection",
    outcome: "success",
    contributor: "REST",
    target: "c64u",
    message: "Connected to c64u",
  },
  {
    timestamp: isoMinutesAgo(12),
    kind: "health-check",
    outcome: "success",
    contributor: "App",
    target: "c64u",
    message: "Health check Healthy",
  },
] as const;

export const TRACE_SEED: TraceEvent[] = buildTraceSeed();

export const HVSC_STATUS_SUMMARY = {
  download: { status: "idle" },
  extraction: { status: "idle" },
  lastUpdatedAt: null,
};

export const installFixedClock = async (page: Page) => {
  await page.addInitScript(
    ({ nowMs }) => {
      const OriginalDate = Date;
      class FixedDate extends OriginalDate {
        constructor(...args: ConstructorParameters<DateConstructor>) {
          if (args.length === 0) {
            super(nowMs);
          } else {
            super(...args);
          }
        }
        static now() {
          return nowMs;
        }
      }
      FixedDate.UTC = OriginalDate.UTC;
      FixedDate.parse = OriginalDate.parse;
      window.Date = FixedDate as DateConstructor;
    },
    { nowMs: FIXED_NOW_MS },
  );
};

export const installStableStorage = async (page: Page) => {
  await page.addInitScript(
    ({ playlist, disks, logs, hvscSummary, fixedNowIso }) => {
      localStorage.setItem("c64u_playlist:v1:TEST-123", JSON.stringify(playlist));
      localStorage.setItem("c64u_playlist:v1:default", JSON.stringify(playlist));
      localStorage.setItem("c64u_last_device_id", "TEST-123");
      localStorage.setItem("c64u_disk_library:TEST-123", JSON.stringify({ disks }));
      localStorage.setItem("c64u_app_logs", JSON.stringify(logs));
      localStorage.setItem("c64u_hvsc_status:v1", JSON.stringify(hvscSummary));
      localStorage.setItem("c64u_feature_flag:hvsc_enabled", "1");
      sessionStorage.setItem("c64u_feature_flag:hvsc_enabled", "1");
      localStorage.setItem("c64u_demo_clock", fixedNowIso);
      if (!localStorage.getItem("c64u_local_sources:v1")) {
        localStorage.setItem(
          "c64u_local_sources:v1",
          JSON.stringify([
            {
              id: "seed-local-source",
              name: "Seed Local",
              rootName: "Local",
              rootPath: "/Local/",
              createdAt: "2024-03-20T12:00:00.000Z",
              entries: [
                {
                  name: "seed.sid",
                  relativePath: "Local/seed.sid",
                  sizeBytes: 1024,
                  modifiedAt: "2024-03-20T12:00:00.000Z",
                },
              ],
            },
          ]),
        );
      }
    },
    {
      playlist: PLAYLIST_SEED,
      disks: DISK_LIBRARY_SEED,
      logs: LOG_SEED,
      hvscSummary: HVSC_STATUS_SUMMARY,
      fixedNowIso: FIXED_NOW_ISO,
    },
  );
};

export const installLocalSourceSeed = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "c64u_local_sources:v1",
      JSON.stringify([
        {
          id: "seed-local-source",
          name: "Seed Local",
          rootName: "Local",
          rootPath: "/Local/",
          createdAt: "2024-03-20T12:00:00.000Z",
          entries: [
            {
              name: "seed.sid",
              relativePath: "Local/seed.sid",
              sizeBytes: 1024,
              modifiedAt: "2024-03-20T12:00:00.000Z",
            },
          ],
        },
      ]),
    );
  });
};

export const installListPreviewLimit = async (page: Page, limit: number) => {
  await page.addInitScript(
    ({ listLimit }) => {
      localStorage.setItem("c64u_list_preview_limit", String(listLimit));
    },
    { listLimit: limit },
  );
};

export const seedDiagnosticsTraces = async (page: Page) => {
  await page.evaluate((seed) => {
    return new Promise<void>((resolve) => {
      const handler = () => {
        window.clearTimeout(timeout);
        window.removeEventListener("c64u-traces-updated", handler);
        setTimeout(resolve, 50);
      };
      const timeout = window.setTimeout(() => {
        window.removeEventListener("c64u-traces-updated", handler);
        resolve();
      }, 250);
      window.addEventListener("c64u-traces-updated", handler);
      const tracing = (
        window as Window & {
          __c64uTracing?: { seedTraces?: (events: TraceEvent[]) => void };
        }
      ).__c64uTracing;
      tracing?.seedTraces?.(seed as TraceEvent[]);
      if (!tracing?.seedTraces) {
        window.clearTimeout(timeout);
        window.removeEventListener("c64u-traces-updated", handler);
        resolve();
      }
    });
  }, TRACE_SEED);
};

export const seedDiagnosticsTracesForAction = async (page: Page, actionName: string) => {
  const correlationIds = new Set(
    TRACE_SEED.filter((event) => event.type === "action-start" && event.data.name === actionName).map(
      (event) => event.correlationId,
    ),
  );
  const filteredSeed = TRACE_SEED.filter((event) => correlationIds.has(event.correlationId));
  await page.evaluate((seed) => {
    return new Promise<void>((resolve) => {
      const handler = () => {
        window.clearTimeout(timeout);
        window.removeEventListener("c64u-traces-updated", handler);
        setTimeout(resolve, 50);
      };
      const timeout = window.setTimeout(() => {
        window.removeEventListener("c64u-traces-updated", handler);
        resolve();
      }, 250);
      window.addEventListener("c64u-traces-updated", handler);
      const tracing = (
        window as Window & {
          __c64uTracing?: { seedTraces?: (events: TraceEvent[]) => void };
        }
      ).__c64uTracing;
      tracing?.seedTraces?.(seed as TraceEvent[]);
      if (!tracing?.seedTraces) {
        window.clearTimeout(timeout);
        window.removeEventListener("c64u-traces-updated", handler);
        resolve();
      }
    });
  }, filteredSeed);
};

export const seedDiagnosticsLogs = async (page: Page) => {
  await page.evaluate((seedLogs) => {
    return new Promise<void>((resolve) => {
      const handler = () => {
        window.clearTimeout(timeout);
        window.removeEventListener("c64u-logs-updated", handler);
        setTimeout(resolve, 50);
      };
      const timeout = window.setTimeout(() => {
        window.removeEventListener("c64u-logs-updated", handler);
        resolve();
      }, 250);
      window.addEventListener("c64u-logs-updated", handler);
      localStorage.setItem("c64u_app_logs", JSON.stringify(seedLogs));
      window.dispatchEvent(new CustomEvent("c64u-logs-updated"));
    });
  }, LOG_SEED);
};

export const seedDiagnosticsAnalytics = async (page: Page) => {
  await page.waitForFunction(() => {
    const bridge = (
      window as Window & {
        __c64uDiagnosticsTestBridge?: {
          seedAnalytics?: (...args: unknown[]) => void;
          seedOverlayState?: (...args: unknown[]) => void;
        };
      }
    ).__c64uDiagnosticsTestBridge;
    return typeof bridge?.seedAnalytics === "function" && typeof bridge?.seedOverlayState === "function";
  });

  await page.evaluate(
    (seed) => {
      const bridge = (
        window as Window & {
          __c64uDiagnosticsTestBridge?: {
            seedAnalytics?: (payload: {
              healthHistory: unknown[];
              latencySamples: unknown[];
              recoveryEvents: unknown[];
            }) => void;
            seedOverlayState?: (payload: {
              lastHealthCheckResult: unknown;
              healthCheckRunning: boolean;
              liveHealthCheckProbes: null;
            }) => void;
          };
        }
      ).__c64uDiagnosticsTestBridge;
      // Remap health history timestamps to be relative to the browser's current time so
      // the health history chart shows its full dataset regardless of when screenshots run.
      const browserNow = Date.now();
      const liveHealthHistory = seed.healthHistory.map((entry: { minutesAgo: number } & Record<string, unknown>) => ({
        ...entry,
        timestamp: new Date(browserNow - entry.minutesAgo * 60_000).toISOString(),
      }));
      bridge?.seedAnalytics?.({ ...seed, healthHistory: liveHealthHistory });
      bridge?.seedOverlayState?.({
        lastHealthCheckResult: seed.lastHealthCheckResult,
        healthCheckRunning: false,
        liveHealthCheckProbes: null,
      });
    },
    {
      healthHistory: HEALTH_HISTORY_SEED.map((entry, index) => ({
        ...entry,
        minutesAgo: 240 - index * 20,
      })),
      latencySamples: LATENCY_SAMPLE_SEED.map((sample) => ({
        ...sample,
        timestampMs: FIXED_NOW_MS - sample.minutesAgo * 60_000,
      })),
      recoveryEvents: RECOVERY_EVIDENCE_SEED,
      lastHealthCheckResult: HEALTH_CHECK_RESULT_SEED,
    },
  );
};
