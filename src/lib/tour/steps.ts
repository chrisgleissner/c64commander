/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The first-run tour (spec.md section 8).
 *
 * It drives the REAL app: it navigates to each page, spotlights the actual elements, and captions
 * them. The user sees the app rather than pictures of it, and the tour is the same length every
 * time — a step whose anchors cannot appear degrades to the same caption with no spotlight rather
 * than being skipped.
 *
 * Each step points at the thing it describes, not at the tab that leads there: a highlighted tab
 * icon shows where a page is and nothing of what it does.
 *
 * Captions are written for someone who has never used a C64 and must fit the smallest screen: a
 * title of one line and a body of two, so the caption leaves at least half of a 320 x 427 CSS px
 * screen showing. `tourCaptionBudget.test.ts` holds the lengths.
 */

/** What a caption may depend on, read when the step is shown. */
export interface TourContext {
  /** Whether the HVSC music collection is installed, which SID Radio needs before it can play. */
  readonly hvscInstalled: boolean;
}

export interface TourStep {
  readonly id: string;
  readonly title: string;
  /** A body that depends on what is installed is a function of the context. */
  readonly body: string | ((context: TourContext) => string);
  /**
   * Said instead of `body` when a machine is connected and the step's anchor still never appeared:
   * the connected device does not have the feature, and the usual body would describe something the
   * user cannot see.
   */
  readonly unavailableBody?: string;
  /**
   * Where to go and what to spotlight. `testIds` is a LIST because a step may point at more than
   * one element — the Last and Recent tiles, say — and the spotlight is then the union of their
   * rects. Absent for a step that explains rather than points.
   */
  readonly anchor?: {
    readonly path: string;
    readonly scope?: string;
    readonly sectionId?: string;
    readonly testIds: readonly string[];
  };
  /** True for a step that only makes sense with a machine attached. */
  readonly requiresDevice?: boolean;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "what-this-is",
    title: "Welcome",
    body: "Controls your C64, and plays C64 music by itself too.",
  },
  {
    id: "search",
    title: "Search everything",
    body: "Find pages, settings, tunes and disks from this field.",
    anchor: { path: "/", testIds: ["home-search-field"] },
  },
  {
    id: "listening-without-a-c64",
    title: "Music without a C64",
    /*
     * "No network needed" was true only once the HVSC collection had been downloaded, and a new
     * installation has not downloaded it: every station is disabled until it has.
     */
    body: ({ hvscInstalled }) =>
      hvscInstalled
        ? "Radio plays C64 tunes right here. No C64 needed."
        : "Radio plays C64 tunes here after a free one-time download.",
    anchor: { path: "/", scope: "home", sectionId: "quick-actions", testIds: ["home-tile-action.sid-radio"] },
  },
  {
    id: "your-tunes",
    title: "Carry on listening",
    body: "Last resumes your tune. Recent lists what you played.",
    anchor: {
      path: "/",
      scope: "home",
      sectionId: "quick-actions",
      testIds: ["home-tile-action.resume-session", "home-tile-action.recently-played"],
    },
  },
  {
    id: "playlists",
    title: "Build a playlist",
    body: "Add tunes and programs from this device or from your C64.",
    anchor: { path: "/play", testIds: ["add-items-to-playlist"] },
  },
  {
    id: "disks",
    title: "Disks and games",
    body: "Put a disk in a drive and your C64 runs what is on it.",
    anchor: { path: "/disks", testIds: ["disks-section-toggle-drive-a", "drive-mount-toggle-a"] },
  },
  {
    id: "connecting",
    title: "Your connection",
    body: "Shows whether your C64 is connected. Tap it for details.",
    anchor: { path: "/", testIds: ["unified-health-badge"] },
    requiresDevice: true,
  },
  {
    id: "controlling-the-machine",
    title: "Control the machine",
    body: "Reset your C64 here. Power restarts it or turns it off.",
    anchor: {
      path: "/",
      scope: "home",
      sectionId: "quick-actions",
      testIds: ["home-machine-reset", "home-power-actions"],
    },
    requiresDevice: true,
  },
  {
    id: "live-view",
    title: "Watch, listen, play",
    body: "See and hear your C64 here. Game Mode adds a joystick.",
    unavailableBody: "Picture and sound need a C64 Ultimate or an Ultimate 64.",
    anchor: { path: "/", scope: "home", sectionId: "live-view", testIds: ["live-view-card"] },
    requiresDevice: true,
  },
  {
    id: "configuration",
    title: "Machine settings",
    body: "Every setting your C64 has. Change it here, it changes there.",
    anchor: { path: "/config", testIds: ["config-category-list"] },
    requiresDevice: true,
  },
  {
    id: "getting-around",
    title: "Keys work too",
    body: "1 to 6 open pages, 7 searches, arrows move the highlight.",
    anchor: { path: "/", testIds: ["tab-bar"] },
  },
  {
    id: "docs",
    title: "Help is built in",
    body: "Docs has short guides, and starts this tour again.",
    anchor: { path: "/docs", testIds: ["docs-tour-start"] },
  },
  {
    id: "making-it-yours",
    title: "Make it yours",
    body: "Color styles, Light or Dark, and larger text are here.",
    anchor: { path: "/settings", scope: "settings", sectionId: "appearance", testIds: ["settings-app-style"] },
  },
];

/** The caption's body for `step` in `context`. */
export const stepBody = (step: TourStep, context: TourContext): string =>
  typeof step.body === "function" ? step.body(context) : step.body;

/** The steps offered again after a first connection, when they ran with nothing attached. */
export const DEVICE_STEP_IDS: readonly string[] = TOUR_STEPS.filter((step) => step.requiresDevice).map(
  (step) => step.id,
);

export const tourStepIndex = (stepId: string | null): number => {
  if (stepId === null) return 0;
  const index = TOUR_STEPS.findIndex((step) => step.id === stepId);
  return index < 0 ? 0 : index;
};
