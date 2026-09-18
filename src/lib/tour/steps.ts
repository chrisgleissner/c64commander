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
 * The steps cover what the app does, not what was added to it most recently: playing music with no
 * machine attached, playlists and where content comes from, disks, connecting and controlling a
 * machine, watching and steering it, its configuration, getting around without touching the screen,
 * the built-in guides, and appearance. Captions are written for someone who has never used a C64:
 * short sentences, no abbreviations, and no word that only means something to this app.
 */

export interface TourStep {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /**
   * Where to go and what to spotlight. `testIds` is a LIST because a step may point at more than
   * one element — step 4 highlights both the Last and the Recent tile — and the spotlight is then
   * the union of their rects. Absent for a step that explains rather than points.
   */
  readonly anchor?: {
    readonly path: string;
    readonly scope?: string;
    readonly sectionId?: string;
    readonly testIds: readonly string[];
  };
  /** True for a step that only makes sense with a machine attached (steps 5 to 7). */
  readonly requiresDevice?: boolean;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "what-this-is",
    title: "What this app is",
    body: "Your C64's remote control and music player. It plays C64 music on its own too.",
  },
  {
    id: "search",
    title: "Everything is one search away",
    body: "Finds any page, setting, tune or disk. It is the field at the top of Home.",
    anchor: { path: "/", testIds: ["home-search-field"] },
  },
  {
    id: "listening-without-a-c64",
    title: "Music with no C64",
    body: "Radio plays thousands of C64 tunes here. No C64 and no network needed.",
    anchor: { path: "/", scope: "home", sectionId: "quick-actions", testIds: ["home-tile-action.sid-radio"] },
  },
  {
    id: "your-tunes",
    title: "Pick up where you left off",
    body: "Last returns to the tune you were playing. Recent lists what you opened before.",
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
    body: "Play holds your music and programs — from here, from your C64, or from a free library.",
    anchor: { path: "/play", testIds: ["tab-play"] },
  },
  {
    id: "disks",
    title: "Disks and games",
    body: "Load a disk image and your C64 runs what is on it. Keep a collection and swap between them.",
    anchor: { path: "/disks", testIds: ["tab-disks"] },
  },
  {
    id: "connecting",
    title: "Connecting your C64",
    body: "Keep this device and your C64 on one network. The badge shows the connection.",
    anchor: { path: "/", testIds: ["unified-health-badge"] },
    requiresDevice: true,
  },
  {
    id: "controlling-the-machine",
    title: "Controlling the machine",
    body: "Reset, pause and power off here. The cards below hold drives, sound and lights.",
    anchor: { path: "/", scope: "home", sectionId: "quick-actions", testIds: ["home-quick-actions"] },
    requiresDevice: true,
  },
  {
    id: "live-view",
    title: "Watch, listen and play",
    body: "See and hear your C64 here, and steer it. Game Mode starts both and adds a joystick.",
    anchor: { path: "/", scope: "home", sectionId: "live-view", testIds: ["live-view-card"] },
    requiresDevice: true,
  },
  {
    id: "configuration",
    title: "Every machine setting",
    body: "Every setting your C64 has, read from the machine. Change it here, it changes there.",
    anchor: { path: "/config", testIds: ["tab-config"] },
    requiresDevice: true,
  },
  {
    id: "getting-around",
    title: "Getting around without the screen",
    body: "A keypad works too: 1 to 6 open the pages, 7 opens search, and a highlight follows you.",
    anchor: { path: "/", testIds: ["tab-home"] },
  },
  {
    id: "docs",
    title: "Help is built in",
    body: "Docs has short guides, and starts this tour again whenever you want it.",
    anchor: { path: "/docs", testIds: ["docs-tour-start"] },
  },
  {
    id: "making-it-yours",
    title: "Making it yours",
    body: "Seven colour styles over Light and Dark, larger text, and a tighter or roomier layout.",
    anchor: { path: "/settings", scope: "settings", sectionId: "appearance", testIds: ["settings-app-style"] },
  },
];

/** The steps offered again after a first connection, when they ran with nothing attached. */
export const DEVICE_STEP_IDS: readonly string[] = TOUR_STEPS.filter((step) => step.requiresDevice).map(
  (step) => step.id,
);

export const tourStepIndex = (stepId: string | null): number => {
  if (stepId === null) return 0;
  const index = TOUR_STEPS.findIndex((step) => step.id === stepId);
  return index < 0 ? 0 : index;
};
