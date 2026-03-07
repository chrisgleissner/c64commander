import { z } from "zod";

// ---------------------------------------------------------------------------
// Route rules (EXP-001) — encoded from agentic-action-model.md
// ---------------------------------------------------------------------------

export type ExplorationSafety = "read-only" | "guarded-mutation" | "destructive";

export interface RouteRule {
  route: string;
  label: string;
  preconditions: string[];
  actionFamilies: readonly string[];
  postconditionStrategy: string;
  recoveryStrategy: string;
  escapeCondition: string;
}

export const routeRules: readonly RouteRule[] = [
  {
    route: "/",
    label: "Home",
    preconditions: [
      "Connection state is known.",
      "For machine or RAM actions, target device mode and safety budget are recorded.",
    ],
    actionFamilies: [
      "Machine controls",
      "RAM save/load/clear",
      "Quick config changes",
      "LED, SID, drive, printer, and stream controls",
      "App config snapshot save/load/manage",
    ],
    postconditionStrategy:
      "UI state plus REST/state-ref or diagnostics confirmation. Destructive actions require a second oracle.",
    recoveryStrategy: "Refresh route data once. Re-run manual discovery once if device dropped unexpectedly.",
    escapeCondition:
      "Abort if power, reset, RAM clear, or flash-config effects are no longer attributable to the current case.",
  },
  {
    route: "/play",
    label: "Play",
    preconditions: [
      "Source availability is known: Local, C64U, HVSC, or any combination required by the case.",
      "Background execution expectations are set for Android cases.",
    ],
    actionFamilies: [
      "Open add-items flows and browse sources",
      "Build or edit a playlist",
      "Start, stop, pause, resume, next, previous",
      "Toggle shuffle and repeat",
      "Edit duration, subsong, and songlength metadata",
      "Adjust volume or mute",
      "Run HVSC download, install, browse, and play flows",
    ],
    postconditionStrategy:
      "Playlist changes need UI plus durable state. Playback needs UI transport state plus A/V oracle for physical cases.",
    recoveryStrategy: "Cancel long-running add-items or HVSC flow once. Re-enter route if source dialog is stale.",
    escapeCondition:
      "Stop if add-items recursion, HVSC ingestion, or background auto-advance becomes non-deterministic after one retry.",
  },
  {
    route: "/disks",
    label: "Disks",
    preconditions: [
      "Test-owned disk fixtures or namespaces are known.",
      "Mounted-state baseline is captured before destructive operations.",
    ],
    actionFamilies: [
      "Import from Local or C64U",
      "Mount and eject",
      "Toggle drive power or reset drives",
      "Change drive bus ID or drive type",
      "Set Soft IEC default path",
      "Rename, regroup, delete, or bulk delete library entries",
    ],
    postconditionStrategy:
      "Mount/eject needs drive-state confirmation. Delete needs library diff and mounted-state confirmation.",
    recoveryStrategy: "Refresh drive data once. Re-open mount dialog once if it loses selection state.",
    escapeCondition: "Abort if the target disk set is not isolated from user data.",
  },
  {
    route: "/config",
    label: "Config",
    preconditions: [
      "Category names are discovered from the live page, not assumed.",
      "The agent knows whether the case is read-only or mutation.",
    ],
    actionFamilies: [
      "Search categories",
      "Expand categories and inspect items",
      "Edit text, select, switch, and slider values",
      "Use Audio Mixer solo and reset flows",
      "Trigger clock synchronization",
    ],
    postconditionStrategy:
      "Edited value must round-trip through UI and REST-visible state. Audio Mixer needs adjacent-item verification.",
    recoveryStrategy: "Re-open category once if data refetches during editing.",
    escapeCondition: "Stop when the expected hardware-visible effect is not specified well enough.",
  },
  {
    route: "/settings",
    label: "Settings",
    preconditions: [
      "Decide whether the case is read-only, guarded mutation, or destructive.",
      "For settings transfer or diagnostics export, define the target namespace first.",
    ],
    actionFamilies: [
      "Connection host/password and manual reconnect",
      "Automatic demo mode and discovery timing settings",
      "Appearance, list preview, disk autostart, debug logging, HVSC enablement",
      "Diagnostics dialog, clear, and export",
      "Settings export and import",
      "Device Safety preset and advanced knobs",
      "Developer mode unlock and support links",
    ],
    postconditionStrategy:
      "Persistence changes must survive route changes or relaunch. Diagnostics changes must be reflected in logs or exported artifacts.",
    recoveryStrategy: "Re-open diagnostics dialog once. Re-run manual discovery once after connection changes.",
    escapeCondition: "Stop if mutation would affect later cases and no cleanup path is defined.",
  },
  {
    route: "/docs",
    label: "Docs",
    preconditions: [],
    actionFamilies: ["Open and close each accordion section", "Validate that key help topics render"],
    postconditionStrategy: "UI-only oracle is sufficient.",
    recoveryStrategy: "Re-open a section once if it collapses due to route-level rerender.",
    escapeCondition: "None.",
  },
  {
    route: "/settings/open-source-licenses",
    label: "Licenses",
    preconditions: [],
    actionFamilies: ["Open the page", "Validate the bundled notice rendering path", "Navigate back to Settings"],
    postconditionStrategy: "UI-only oracle plus error-log absence if the page failed to load.",
    recoveryStrategy: "Reload the route once.",
    escapeCondition: "None.",
  },
] as const;

// ---------------------------------------------------------------------------
// Dialog rules (EXP-001) — encoded from agentic-action-model.md
// ---------------------------------------------------------------------------

export const dialogRules = {
  expandOnlyVisible: "Expand accordions or dialogs only when their header or trigger is visible.",
  closeBeforeRouteChange:
    "Close transient dialogs before route changes unless the case explicitly validates persistence across navigation.",
  singleSurface:
    "Prefer single-surface exploration: do not stack Home, Settings, and global diagnostics dialogs at once.",
  destructiveCapture:
    "When a dialog performs destructive work, capture both the confirmation surface and the post-action state.",
} as const;

// ---------------------------------------------------------------------------
// Default exploration order (EXP-001) — from action model
// ---------------------------------------------------------------------------

export const defaultExplorationOrder: readonly string[] = [
  "/",
  "/play",
  "/disks",
  "/config",
  "/settings",
  "/docs",
  "/settings/open-source-licenses",
];

// ---------------------------------------------------------------------------
// Helpers (EXP-001 + EXP-003)
// ---------------------------------------------------------------------------

export function getRouteRule(route: string): RouteRule | undefined {
  return routeRules.find((r) => r.route === route);
}

export function listPublicRoutes(): string[] {
  return routeRules.map((r) => r.route);
}

/**
 * Classify whether a given safety class is allowed in the current exploration
 * budget. Read-only is always allowed. Guarded requires explicit opt-in.
 * Destructive is refused unless the budget explicitly names it.
 */
export function shouldRefuseAction(
  actionSafety: ExplorationSafety,
  budget: ExplorationSafety,
): { refuse: boolean; reason: string } {
  const rank: Record<ExplorationSafety, number> = {
    "read-only": 0,
    "guarded-mutation": 1,
    destructive: 2,
  };

  if (rank[actionSafety] > rank[budget]) {
    return {
      refuse: true,
      reason: `Action safety "${actionSafety}" exceeds exploration budget "${budget}".`,
    };
  }
  return { refuse: false, reason: "" };
}

/**
 * Check whether the preconditions for a route are satisfiable given the
 * current known state. Returns unmet preconditions.
 */
export function checkPreconditions(route: string, satisfiedPreconditions: string[]): string[] {
  const rule = getRouteRule(route);
  if (!rule) return [`Unknown route: ${route}`];
  return rule.preconditions.filter((p) => !satisfiedPreconditions.includes(p));
}

// ---------------------------------------------------------------------------
// Exploration trace (EXP-004)
// ---------------------------------------------------------------------------

export const explorationTraceSchema = z.object({
  route: z.string(),
  preconditions: z.array(z.string()),
  visibleControls: z.array(z.string()),
  chosenAction: z.string(),
  safety: z.enum(["read-only", "guarded-mutation", "destructive"]),
  outcome: z.enum(["completed", "recovered", "escaped", "refused"]),
  cleanupOutcome: z.string().nullable(),
  recordedAt: z.string(),
});

export type ExplorationTrace = z.infer<typeof explorationTraceSchema>;

export function createExplorationTrace(input: {
  route: string;
  preconditions: string[];
  visibleControls: string[];
  chosenAction: string;
  safety: ExplorationSafety;
  outcome: ExplorationTrace["outcome"];
  cleanupOutcome?: string;
}): ExplorationTrace {
  return explorationTraceSchema.parse({
    ...input,
    cleanupOutcome: input.cleanupOutcome ?? null,
    recordedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Bounded discovery (EXP-002 + EXP-003)
// ---------------------------------------------------------------------------

export interface DiscoveryPlan {
  route: string;
  label: string;
  safety: ExplorationSafety;
  expectedControls: string[];
}

/**
 * Build a read-only discovery plan for all public routes.
 * Each plan targets a single route with read-only safety.
 */
export function buildReadOnlyDiscoveryPlan(): DiscoveryPlan[] {
  return routeRules.map((rule) => ({
    route: rule.route,
    label: rule.label,
    safety: "read-only" as const,
    expectedControls: [...rule.actionFamilies],
  }));
}

/**
 * Build a discovery plan for a single route with the given safety budget.
 * Actions that exceed the budget are excluded from expectedControls.
 */
export function buildRouteDiscoveryPlan(route: string, budget: ExplorationSafety): DiscoveryPlan | undefined {
  const rule = getRouteRule(route);
  if (!rule) return undefined;
  return {
    route: rule.route,
    label: rule.label,
    safety: budget,
    expectedControls: [...rule.actionFamilies],
  };
}
