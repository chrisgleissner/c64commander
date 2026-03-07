import type { AssertionDefinition, EvidenceTypeDefinition } from "./types.js";

export const assertionCatalog: AssertionDefinition[] = [
  {
    id: "ui-element-present",
    title: "UI element is present and visible",
    oracleClass: "UI",
    description: "Verify a specific UI element exists and is visible on screen.",
  },
  {
    id: "ui-text-matches",
    title: "UI text content matches expected value",
    oracleClass: "UI",
    description: "Verify displayed text matches the expected string or pattern.",
  },
  {
    id: "rest-state-matches",
    title: "REST-visible state matches expected value",
    oracleClass: "REST-visible state",
    description: "Verify a REST API response from the C64U matches the expected state after an app action.",
  },
  {
    id: "ftp-file-present",
    title: "FTP-visible file exists on C64U storage",
    oracleClass: "FTP-visible state",
    description: "Verify a file exists at the expected FTP path on the C64U.",
  },
  {
    id: "filesystem-artifact-present",
    title: "Android filesystem artifact exists",
    oracleClass: "Filesystem-visible state",
    description: "Verify an expected file or directory exists on the Android device.",
  },
  {
    id: "diagnostics-log-entry",
    title: "Diagnostics log contains expected entry",
    oracleClass: "Diagnostics and logs",
    description: "Verify the app diagnostics logs contain an expected event or entry.",
  },
  {
    id: "playback-start-visible",
    title: "Playback start visible on real hardware",
    oracleClass: "A/V signal",
    description: "Use c64scope capture plus app timeline correlation to prove playback started.",
  },
  {
    id: "playlist-progression",
    title: "Playlist progression is attributable",
    oracleClass: "UI plus A/V plus diagnostics",
    description: "Require recorded app action, current-item update, and corroborating progression evidence.",
  },
  {
    id: "settings-persisted",
    title: "Setting change persists across navigation",
    oracleClass: "UI plus filesystem or local persistence",
    description: "Require the value to round-trip after route change or relaunch.",
  },
  {
    id: "connection-state-matches",
    title: "Connection state matches expected value",
    oracleClass: "UI plus connection snapshot",
    description: "Verify the app connection indicator and snapshot match the expected connectivity state.",
  },
  {
    id: "drive-state-matches",
    title: "Drive state matches expected mount/power/type",
    oracleClass: "REST-visible state",
    description: "Verify drive mount state, power, bus ID, and type match expectations via REST API.",
  },
];

export const failureTaxonomy = {
  product_failure: [
    "App behavior is wrong while the lab is healthy.",
    "Expected state transition or artifact did not occur.",
  ],
  infrastructure_failure: [
    "Capture unavailable or degraded.",
    "Approved peer server unavailable.",
    "Android runtime or filesystem path unhealthy.",
  ],
  inconclusive: [
    "Evidence is missing, conflicting, or cannot attribute cause.",
    "Timeline gaps prevent deterministic verdicts.",
  ],
};

/**
 * Canonical evidence types for observation layer attachment.
 * Each type maps to an oracle class and declares required metadata fields.
 */
export const evidenceTypeCatalog: EvidenceTypeDefinition[] = [
  {
    type: "screenshot",
    description: "Mobile device screenshot captured through the controller.",
    oracleClass: "UI",
    requiredMetadata: [],
  },
  {
    type: "diagnostics_export",
    description: "App diagnostics ZIP exported via the Android share API.",
    oracleClass: "Diagnostics and logs",
    requiredMetadata: [],
  },
  {
    type: "logcat",
    description: "Android logcat output filtered for the app process.",
    oracleClass: "Diagnostics and logs",
    requiredMetadata: [],
  },
  {
    type: "rest_snapshot",
    description: "JSON snapshot of a C64U REST API response.",
    oracleClass: "REST-visible state",
    requiredMetadata: ["endpoint"],
  },
  {
    type: "ftp_snapshot",
    description: "File listing or content snapshot from the C64U FTP server.",
    oracleClass: "FTP-visible state",
    requiredMetadata: ["remotePath"],
  },
  {
    type: "state_ref",
    description: "Snapshot of an app-internal or device state value for later comparison.",
    oracleClass: "UI + persistence",
    requiredMetadata: ["stateKey"],
  },
  {
    type: "config_snapshot",
    description: "Named configuration snapshot exported from the app.",
    oracleClass: "UI + persistence",
    requiredMetadata: ["snapshotName"],
  },
  {
    type: "trace_export",
    description: "App trace export (REST request log, navigation history).",
    oracleClass: "Diagnostics and logs",
    requiredMetadata: [],
  },
  {
    type: "stream_capture",
    description: "UDP stream capture from C64U (video, audio, or debug).",
    oracleClass: "A/V signal",
    requiredMetadata: ["streamType"],
  },
];
