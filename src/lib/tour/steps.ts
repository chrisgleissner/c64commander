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
 */

export interface TourStep {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /**
   * Where to go and what to spotlight. `testIds` is a LIST because a step may point at more than
   * one element — step 4 highlights both the Resume and the Recent tile — and the spotlight is then
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
    body: "A remote control and a music player for your Commodore 64 Ultimate — and a SID music player on its own, with no C64 needed at all.",
  },
  {
    id: "search",
    title: "Everything is one search away",
    body: "Search finds every page, setting, action, tune and disk by name. Tap the field at the top of Home, use the Quick menu, or press 7 on a keypad.",
    anchor: { path: "/", testIds: ["home-search-field"] },
  },
  {
    id: "listening-without-a-c64",
    title: "Listening with no C64",
    body: "SID Radio plays thousands of tunes on this device alone. No network, no hardware — just pick a mood.",
    anchor: { path: "/", scope: "home", sectionId: "listen-and-play", testIds: ["home-tile-action.sid-radio"] },
  },
  {
    id: "your-tunes",
    title: "Your tunes: resume and recent",
    body: "Resume picks up the last tune where it stopped. Recent is the way back to anything you have opened before.",
    anchor: {
      path: "/",
      scope: "home",
      sectionId: "listen-and-play",
      testIds: ["home-tile-action.resume-session", "home-tile-action.recently-played"],
    },
  },
  {
    id: "connecting",
    title: "Connecting a C64 Ultimate",
    body: "Keep this device and your C64 Ultimate on the same network. The header badge shows the connection — tap it for Diagnostics, long-press to switch devices.",
    anchor: { path: "/", testIds: ["unified-health-badge"] },
    requiresDevice: true,
  },
  {
    id: "controlling-the-machine",
    title: "Controlling the machine",
    body: "Reset, reboot, pause and power off, plus every setting the machine exposes, grouped into cards you open when you need them.",
    anchor: { path: "/", scope: "home", sectionId: "quick-actions", testIds: ["home-quick-actions"] },
    requiresDevice: true,
  },
  {
    id: "live-view",
    title: "Live View and Remote Input",
    body: "Watch and listen to the C64 on this device, and type or steer from here. Game Mode starts both and hands you a joystick.",
    anchor: { path: "/", scope: "home", sectionId: "live-view", testIds: ["live-view-card"] },
    requiresDevice: true,
  },
  {
    id: "making-it-yours",
    title: "Making it yours",
    body: "Seven colour styles on top of Light and Dark, four text sizes, and a display profile that decides how much fits on a screen.",
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
