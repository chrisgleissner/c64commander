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

import type { AppMode } from "@/lib/appMode/appModeStore";
import { isTabPathVisible } from "@/lib/navigation/tabRoutes";

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
   * Said instead of `body` when a machine is connected and the step's anchor still never appeared.
   * The feature is then missing for this device or this platform (Live View also needs the phone's
   * stream receiver), and the usual body would describe something the user cannot see.
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
  /** What differs in SID Player: the same step, worded and anchored for a phone with no machine. */
  readonly sidPlayer?: Partial<Pick<TourStep, "title" | "body" | "anchor">> & { readonly skip?: true };
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "what-this-is",
    title: "Welcome",
    body: "Controls your C64, and plays C64 music by itself too.",
    sidPlayer: { body: "Plays C64 music on this phone." },
  },
  {
    id: "search",
    title: "Search everything",
    body: "Find pages, settings, tunes and disks from this field.",
    anchor: { path: "/", testIds: ["home-search-field"] },
    sidPlayer: { skip: true },
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
    sidPlayer: {
      title: "Start listening",
      body: "Search and Start listening sit at the top of Play.",
      anchor: { path: "/play", testIds: ["home-search-field"] },
    },
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
    sidPlayer: { skip: true },
  },
  {
    id: "playlists",
    title: "Build a playlist",
    body: "Add tunes and programs from this device or from your C64.",
    anchor: { path: "/play", testIds: ["add-items-to-playlist"] },
    sidPlayer: { body: "Add tunes from your files or the music collection." },
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
    body: "Shows whether your C64 is connected. Open it for details.",
    anchor: { path: "/", testIds: ["unified-health-badge"] },
    requiresDevice: true,
  },
  {
    id: "controlling-the-machine",
    title: "Control the machine",
    body: "Reset your C64 here. Power holds the other choices.",
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
    unavailableBody: "Live View is not available with this machine or phone.",
    anchor: { path: "/", scope: "home", sectionId: "live-view", testIds: ["live-view-card"] },
    requiresDevice: true,
  },
  {
    id: "configuration",
    title: "Machine settings",
    body: "Every setting your C64 has. Change it here, it changes there.",
    anchor: { path: "/config", testIds: ["config-categories"] },
    requiresDevice: true,
  },
  {
    id: "getting-around",
    title: "Keys work too",
    body: "1 to 6 open pages, 7 searches, arrows move the highlight.",
    anchor: { path: "/", testIds: ["tab-bar"] },
    sidPlayer: {
      body: "1 to 3 open pages, 7 searches, arrows move the highlight.",
      anchor: { path: "/play", testIds: ["tab-bar"] },
    },
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

/**
 * The steps this mode tours: SID Player words and anchors its own, and leaves out a step that needs a
 * machine, a step it marks as skipped, or a step whose page the mode hides.
 */
export const tourStepsFor = (appMode: AppMode): readonly TourStep[] => {
  if (appMode === "full") return TOUR_STEPS;
  return TOUR_STEPS.filter((step) => !step.requiresDevice)
    .filter((step) => !step.sidPlayer?.skip)
    .map((step) => ({ ...step, ...step.sidPlayer }))
    .filter((step) => step.anchor === undefined || isTabPathVisible(step.anchor.path, appMode));
};

/** The caption's body for `step` in `context`. */
export const stepBody = (step: TourStep, context: TourContext): string =>
  typeof step.body === "function" ? step.body(context) : step.body;

/** The steps offered again after a first connection, when they ran with nothing attached. */
export const DEVICE_STEP_IDS: readonly string[] = TOUR_STEPS.filter((step) => step.requiresDevice).map(
  (step) => step.id,
);

export const tourStepIndex = (stepId: string | null, steps: readonly TourStep[] = TOUR_STEPS): number => {
  if (stepId === null) return 0;
  const index = steps.findIndex((step) => step.id === stepId);
  return index < 0 ? 0 : index;
};
