export interface CaseDefinition {
  id: string;
  title: string;
  featureArea: string;
  route: string;
  safetyClass: "read-only" | "guarded-mutation" | "destructive";
  primaryOracle: string;
  fallbackOracle: string;
  cleanup: string;
  docRefs: string[];
  dependencies: string[];
  testability: "ready" | "guarded" | "partial" | "blocked";
  blockerRef?: string;
}

export interface AssertionDefinition {
  id: string;
  title: string;
  oracleClass: string;
  description: string;
}

/**
 * Test-owned namespaces for agentic test isolation.
 * All destructive operations must target only these namespaces.
 */
export const testNamespaces = {
  /** Android app-local staging directory for test fixtures */
  androidStaging: "/sdcard/Download/c64commander-agentic-test/",
  /** C64U FTP path prefix for test-owned disk images */
  c64uDiskPrefix: "/USB0/agentic-test/",
  /** App config snapshot name prefix */
  configSnapshotPrefix: "agentic-test-",
  /** Disk library entry name prefix */
  diskLibraryPrefix: "agentic-test-",
  /** Settings export filename prefix */
  settingsExportPrefix: "agentic-test-settings-",
  /** RAM dump filename prefix */
  ramDumpPrefix: "agentic-test-ram-",
  /** c64scope artifact output directory */
  artifactDir: "artifacts/",
} as const;

export const caseCatalog: CaseDefinition[] = [
  // --- Navigation and Connection (Ready) ---
  {
    id: "nav-route-shell",
    title: "Route shell discovery and tab navigation",
    featureArea: "Navigation",
    route: "/",
    safetyClass: "read-only",
    primaryOracle: "UI tab presence and route transitions",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: "No cleanup required",
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-feature-surface.md",
    ],
    dependencies: [],
    testability: "ready",
  },
  {
    id: "nav-connection-status",
    title: "Connection status and discovery verification",
    featureArea: "Connection",
    route: "/",
    safetyClass: "read-only",
    primaryOracle: "UI connection indicator plus connection snapshot",
    fallbackOracle: "REST /v1/info reachability evidence",
    cleanup: "No cleanup required",
    docRefs: [
      "doc/testing/agentic-tests/agentic-oracle-catalog.md",
      "doc/testing/agentic-tests/agentic-android-runtime-contract.md",
    ],
    dependencies: ["nav-route-shell"],
    testability: "ready",
  },

  // --- Home (Mixed readiness) ---
  {
    id: "home-readonly-visibility",
    title: "Home page read-only surface visibility",
    featureArea: "Home",
    route: "/",
    safetyClass: "read-only",
    primaryOracle: "UI element presence and values",
    fallbackOracle: "REST-visible device info",
    cleanup: "No cleanup required",
    docRefs: ["doc/testing/agentic-tests/agentic-feature-surface.md"],
    dependencies: ["nav-connection-status"],
    testability: "ready",
  },
  {
    id: "home-quick-config",
    title: "Home quick config read and verify",
    featureArea: "Home",
    route: "/",
    safetyClass: "read-only",
    primaryOracle: "UI config values plus REST-visible config",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: "No cleanup required",
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-oracle-catalog.md",
    ],
    dependencies: ["home-readonly-visibility"],
    testability: "ready",
  },
  {
    id: "home-config-snapshot",
    title: "App config snapshot save/load/delete lifecycle",
    featureArea: "Home",
    route: "/",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI plus local persistence",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: `Delete test-owned snapshots matching prefix '${testNamespaces.configSnapshotPrefix}'`,
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-oracle-catalog.md",
    ],
    dependencies: ["home-readonly-visibility"],
    testability: "ready",
  },
  {
    id: "home-machine-controls",
    title: "Home machine control actions (reset/reboot)",
    featureArea: "Home",
    route: "/",
    safetyClass: "destructive",
    primaryOracle: "UI action confirmation plus REST/state-ref change",
    fallbackOracle: "Diagnostics/log entries for issued action",
    cleanup: "Confirm device returns to known connected state",
    docRefs: [
      "doc/testing/agentic-tests/agentic-safety-policy.md",
      "doc/testing/agentic-tests/agentic-action-model.md",
    ],
    dependencies: ["home-readonly-visibility"],
    testability: "guarded",
  },
  {
    id: "home-ram-workflows",
    title: "RAM save/load/clear workflows",
    featureArea: "Home",
    route: "/",
    safetyClass: "destructive",
    primaryOracle: "Filesystem plus REST/state-ref",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: `Remove test-owned RAM dumps at '${testNamespaces.ramDumpPrefix}*'`,
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-open-questions.md",
    ],
    dependencies: ["home-readonly-visibility"],
    testability: "partial",
    blockerRef: "AOQ-002",
  },
  {
    id: "home-drives-printer-stream",
    title: "Home inline drive, printer, and stream controls",
    featureArea: "Home",
    route: "/",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI plus REST/FTP-visible state plus diagnostics",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: "Restore prior drive/stream state",
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-open-questions.md",
    ],
    dependencies: ["home-readonly-visibility"],
    testability: "partial",
    blockerRef: "AOQ-003",
  },

  // --- Play (Mixed readiness) ---
  {
    id: "play-source-browse",
    title: "Play source browsing across Local, C64U, and HVSC",
    featureArea: "Play",
    route: "/play",
    safetyClass: "read-only",
    primaryOracle: "UI source listing plus REST/FTP/filesystem evidence",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: "No cleanup required",
    docRefs: [
      "doc/testing/agentic-tests/agentic-feature-surface.md",
      "doc/testing/agentic-tests/agentic-action-model.md",
    ],
    dependencies: ["nav-route-shell"],
    testability: "ready",
  },
  {
    id: "play-playlist-build",
    title: "Playlist construction and editing",
    featureArea: "Play",
    route: "/play",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI playlist state plus durable state evidence",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: "Clear test-built playlist",
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-oracle-catalog.md",
    ],
    dependencies: ["play-source-browse"],
    testability: "ready",
  },
  {
    id: "play-transport-playback",
    title: "Mixed-format playback transport on real hardware",
    featureArea: "Play",
    route: "/play",
    safetyClass: "guarded-mutation",
    primaryOracle: "Play UI transport state plus c64scope A/V assertions",
    fallbackOracle: "Playlist state plus diagnostics/log evidence",
    cleanup: "Stop playback, stop capture, restore stable route state",
    docRefs: [
      "doc/testing/agentic-tests/c64scope-spec.md",
      "doc/testing/agentic-tests/agentic-android-runtime-contract.md",
    ],
    dependencies: ["play-playlist-build"],
    testability: "ready",
  },
  {
    id: "play-duration-volume",
    title: "Playback duration, subsong, and volume control",
    featureArea: "Play",
    route: "/play",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI state plus REST-visible mixer state",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: "Restore default volume",
    docRefs: [
      "doc/testing/agentic-tests/agentic-oracle-catalog.md",
      "doc/testing/agentic-tests/agentic-action-model.md",
    ],
    dependencies: ["play-transport-playback"],
    testability: "ready",
  },
  {
    id: "play-background-execution",
    title: "Android background playback and lock behavior",
    featureArea: "Play",
    route: "/play",
    safetyClass: "guarded-mutation",
    primaryOracle: "Play state plus Android background-execution logs",
    fallbackOracle: "backgroundAutoSkipDue event plus updated current-item state",
    cleanup: "Stop background execution, return to foreground",
    docRefs: [
      "doc/testing/agentic-tests/agentic-android-runtime-contract.md",
      "doc/testing/agentic-tests/agentic-oracle-catalog.md",
    ],
    dependencies: ["play-transport-playback"],
    testability: "ready",
  },
  {
    id: "play-hvsc-lifecycle",
    title: "HVSC download, install, ingest, browse, and play",
    featureArea: "Play",
    route: "/play",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI status plus progress plus filesystem/ingestion evidence",
    fallbackOracle: "Diagnostics/log evidence with final status",
    cleanup: "Reset HVSC state if isolation required",
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-open-questions.md",
    ],
    dependencies: ["play-source-browse"],
    testability: "guarded",
    blockerRef: "AOQ-007",
  },

  // --- Disks (Guarded/Destructive) ---
  {
    id: "disks-library-browse",
    title: "Disk library browsing and search",
    featureArea: "Disks",
    route: "/disks",
    safetyClass: "read-only",
    primaryOracle: "UI library listing",
    fallbackOracle: "REST/FTP-visible storage state",
    cleanup: "No cleanup required",
    docRefs: [
      "doc/testing/agentic-tests/agentic-feature-surface.md",
      "doc/testing/agentic-tests/agentic-action-model.md",
    ],
    dependencies: ["nav-route-shell"],
    testability: "ready",
  },
  {
    id: "disks-mount-eject",
    title: "Disk mount/eject to Drive A and Drive B",
    featureArea: "Disks",
    route: "/disks",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI plus REST-visible drive/mount state",
    fallbackOracle: "FTP-visible file presence and drive-status text",
    cleanup: "Eject test-mounted disks",
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-oracle-catalog.md",
    ],
    dependencies: ["disks-library-browse"],
    testability: "guarded",
  },
  {
    id: "disks-drive-config",
    title: "Drive power, reset, bus ID, and drive type controls",
    featureArea: "Disks",
    route: "/disks",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI plus REST-visible drive state",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: "Restore baseline drive configuration",
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-safety-policy.md",
    ],
    dependencies: ["disks-library-browse"],
    testability: "guarded",
  },
  {
    id: "disks-library-management",
    title: "Disk library import, rename, delete with test-owned fixtures",
    featureArea: "Disks",
    route: "/disks",
    safetyClass: "destructive",
    primaryOracle: "UI library diff plus mounted-state confirmation",
    fallbackOracle: "FTP-visible storage state",
    cleanup: `Delete only entries matching prefix '${testNamespaces.diskLibraryPrefix}'`,
    docRefs: [
      "doc/testing/agentic-tests/agentic-safety-policy.md",
      "doc/testing/agentic-tests/agentic-action-model.md",
    ],
    dependencies: ["disks-library-browse"],
    testability: "guarded",
  },

  // --- Config (Partial) ---
  {
    id: "config-browse-readonly",
    title: "Config category discovery and read-only browsing",
    featureArea: "Config",
    route: "/config",
    safetyClass: "read-only",
    primaryOracle: "UI category and item listing",
    fallbackOracle: "REST-visible config tree",
    cleanup: "No cleanup required",
    docRefs: [
      "doc/testing/agentic-tests/agentic-feature-surface.md",
      "doc/testing/agentic-tests/agentic-action-model.md",
    ],
    dependencies: ["nav-route-shell"],
    testability: "ready",
  },
  {
    id: "config-edit-roundtrip",
    title: "Config item edit and value round-trip",
    featureArea: "Config",
    route: "/config",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI value round-trip plus REST-visible config state",
    fallbackOracle: "Diagnostics/log confirmation",
    cleanup: "Restore original config value",
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-open-questions.md",
    ],
    dependencies: ["config-browse-readonly"],
    testability: "partial",
    blockerRef: "AOQ-004",
  },
  {
    id: "config-audio-mixer",
    title: "Audio Mixer solo/reset flows",
    featureArea: "Config",
    route: "/config",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI plus REST-visible config plus logs",
    fallbackOracle: "Diagnostics/log confirmation for resets",
    cleanup: "Reset mixer to defaults",
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-open-questions.md",
    ],
    dependencies: ["config-browse-readonly"],
    testability: "partial",
    blockerRef: "AOQ-005",
  },

  // --- Settings (Ready/Partial mix) ---
  {
    id: "settings-connection-theme",
    title: "Settings connection host, theme, and app preferences",
    featureArea: "Settings",
    route: "/settings",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI state plus persistence plus logs",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: "Restore original settings values",
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-oracle-catalog.md",
    ],
    dependencies: ["nav-route-shell"],
    testability: "ready",
  },
  {
    id: "settings-diagnostics",
    title: "Diagnostics dialog tabs, clear, and export",
    featureArea: "Settings",
    route: "/settings",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI plus filesystem/diagnostics-ZIP evidence",
    fallbackOracle: "Diagnostics/log and trace evidence",
    cleanup: "No cleanup required for read; restore after clear",
    docRefs: [
      "doc/testing/agentic-tests/agentic-observability-model.md",
      "doc/testing/agentic-tests/agentic-open-questions.md",
    ],
    dependencies: ["settings-connection-theme"],
    testability: "partial",
    blockerRef: "AOQ-006",
  },
  {
    id: "settings-import-export",
    title: "Settings export and import lifecycle",
    featureArea: "Settings",
    route: "/settings",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI state plus exported file evidence",
    fallbackOracle: "Diagnostics bundle contents",
    cleanup: `Remove test-owned exports matching prefix '${testNamespaces.settingsExportPrefix}'`,
    docRefs: [
      "doc/testing/agentic-tests/agentic-oracle-catalog.md",
      "doc/testing/agentic-tests/agentic-open-questions.md",
    ],
    dependencies: ["settings-connection-theme"],
    testability: "partial",
    blockerRef: "AOQ-006",
  },
  {
    id: "settings-device-safety",
    title: "Device Safety preset and advanced controls",
    featureArea: "Settings",
    route: "/settings",
    safetyClass: "destructive",
    primaryOracle: "UI plus persisted config",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: "Restore baseline safety preset",
    docRefs: [
      "doc/testing/agentic-tests/agentic-safety-policy.md",
      "doc/testing/agentic-tests/agentic-open-questions.md",
    ],
    dependencies: ["settings-connection-theme"],
    testability: "partial",
    blockerRef: "AOQ-009",
  },

  // --- Docs and Licenses (Ready, Read-only) ---
  {
    id: "docs-help-content",
    title: "Docs page accordion sections and help content",
    featureArea: "Docs",
    route: "/docs",
    safetyClass: "read-only",
    primaryOracle: "UI content rendering",
    fallbackOracle: "Error-log absence",
    cleanup: "No cleanup required",
    docRefs: [
      "doc/testing/agentic-tests/agentic-feature-surface.md",
      "doc/testing/agentic-tests/agentic-action-model.md",
    ],
    dependencies: ["nav-route-shell"],
    testability: "ready",
  },
  {
    id: "docs-licenses",
    title: "Open-source licenses page rendering",
    featureArea: "Docs",
    route: "/settings/open-source-licenses",
    safetyClass: "read-only",
    primaryOracle: "UI content rendering",
    fallbackOracle: "Error-log absence",
    cleanup: "No cleanup required",
    docRefs: [
      "doc/testing/agentic-tests/agentic-feature-surface.md",
      "doc/testing/agentic-tests/agentic-action-model.md",
    ],
    dependencies: ["nav-route-shell"],
    testability: "ready",
  },
];

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

export interface EvidenceTypeDefinition {
  type: string;
  description: string;
  oracleClass: string;
  requiredMetadata: string[];
}

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
