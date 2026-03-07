export interface CaseDefinition {
  id: string;
  title: string;
  featureArea: string;
  safetyClass: "read-only" | "guarded-mutation" | "destructive";
  primaryOracle: string;
  fallbackOracle: string;
  cleanup: string;
  docRefs: string[];
}

export interface AssertionDefinition {
  id: string;
  title: string;
  oracleClass: string;
  description: string;
}

export const caseCatalog: CaseDefinition[] = [
  {
    id: "route-shell-readonly",
    title: "Route shell and connection baseline",
    featureArea: "Navigation",
    safetyClass: "read-only",
    primaryOracle: "UI plus connection snapshot",
    fallbackOracle: "Diagnostics/log evidence",
    cleanup: "No cleanup required",
    docRefs: [
      "doc/testing/agentic-tests/agentic-action-model.md",
      "doc/testing/agentic-tests/agentic-oracle-catalog.md",
    ],
  },
  {
    id: "mixed-format-playback",
    title: "Mixed-format playback on real hardware",
    featureArea: "Play",
    safetyClass: "guarded-mutation",
    primaryOracle: "Play UI plus c64scope A/V assertions",
    fallbackOracle: "Playlist state plus diagnostics/log evidence",
    cleanup: "Stop playback, stop capture, restore stable route state",
    docRefs: [
      "doc/testing/agentic-tests/c64scope-spec.md",
      "doc/testing/agentic-tests/agentic-android-runtime-contract.md",
    ],
  },
  {
    id: "settings-diagnostics-persistence",
    title: "Settings and diagnostics persistence",
    featureArea: "Settings",
    safetyClass: "guarded-mutation",
    primaryOracle: "UI plus persisted filesystem evidence",
    fallbackOracle: "Diagnostics ZIP and trace evidence",
    cleanup: "Restore modified setting values",
    docRefs: [
      "doc/testing/agentic-tests/agentic-observability-model.md",
      "doc/testing/agentic-tests/agentic-safety-policy.md",
    ],
  },
];

export const assertionCatalog: AssertionDefinition[] = [
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
