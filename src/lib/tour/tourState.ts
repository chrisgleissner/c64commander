/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";

/**
 * Set on <html> while the tour is running. Home reads it to pin its arrangement (spec.md 7.3), and
 * the swipe layer reads it to disable itself — a swipe that changed the page under a spotlight
 * would leave the spotlight pointing at nothing.
 */
export const TOUR_ACTIVE_ATTRIBUTE = "data-tour-active";

/** spec.md section 8.4. */
export const TOUR_STATE_KEY = "c64u_tour_state:v1";

export interface TourState {
  completedAt: number | null;
  skippedAt: number | null;
  lastStepId: string | null;
  /** Set when the device steps ran with nothing connected, so Home can offer them once later. */
  deviceStepsPending: boolean;
}

export const EMPTY_TOUR_STATE: TourState = {
  completedAt: null,
  skippedAt: null,
  lastStepId: null,
  deviceStepsPending: false,
};

export const loadTourState = (): TourState => {
  if (typeof localStorage === "undefined") return { ...EMPTY_TOUR_STATE };
  try {
    const raw = localStorage.getItem(TOUR_STATE_KEY);
    if (!raw) return { ...EMPTY_TOUR_STATE };
    const parsed = JSON.parse(raw) as Partial<TourState> | null;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_TOUR_STATE };
    return {
      completedAt: typeof parsed.completedAt === "number" ? parsed.completedAt : null,
      skippedAt: typeof parsed.skippedAt === "number" ? parsed.skippedAt : null,
      lastStepId: typeof parsed.lastStepId === "string" ? parsed.lastStepId : null,
      deviceStepsPending: parsed.deviceStepsPending === true,
    };
  } catch (error) {
    addErrorLog("Failed to read tour state", { error: (error as Error).message });
    return { ...EMPTY_TOUR_STATE };
  }
};

export const saveTourState = (state: TourState): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TOUR_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    addErrorLog("Failed to persist tour state", { error: (error as Error).message });
  }
};

/**
 * Whether an installation was already in use before this release.
 *
 * `c64u_tour_state:v1` is new, so it is absent on a first launch AND on every upgrade — which on
 * its own would have offered the tour to the whole existing user base. Any other key this app has
 * written is the signal that separates the two, because a genuinely new installation has none.
 *
 * `E2E_FIRST_LAUNCH_KEY` is the seam playwright/tour.spec.ts uses: its harness has to seed a device
 * and a mock server before the app loads, which would otherwise look exactly like prior use.
 */
export const APP_STORAGE_PREFIX = "c64u_";
export const E2E_FIRST_LAUNCH_KEY = "c64u_e2e_first_launch";

const detectPriorAppState = (): boolean => {
  if (typeof localStorage === "undefined") return false;
  if (localStorage.getItem(E2E_FIRST_LAUNCH_KEY) !== null) return false;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === null || key === TOUR_STATE_KEY) continue;
    if (key.startsWith(APP_STORAGE_PREFIX)) return true;
  }
  return false;
};

/*
 * Sampled once, when this module is first imported, and never again.
 *
 * It has to be. The saved-devices store writes its normalised envelope back the first time anything
 * reads it — on a fresh install `raw` is null, so the write always happens — and that read comes
 * from a `useSyncExternalStore` getSnapshot, which React runs DURING render. Asking this question
 * later therefore found a key the app had just written to itself and concluded the installation was
 * an old one, which meant the first-run tour never opened for a genuinely new user at all. Module
 * initialisation runs before any of that.
 */
let priorAppState = detectPriorAppState();

export const hasPriorAppState = (): boolean => priorAppState;

/** Test seam: re-samples storage, which only module initialisation does in production. */
export const resamplePriorAppStateForTests = (): void => {
  priorAppState = detectPriorAppState();
};

/**
 * True on a first launch of a new installation: nothing recorded, and no sign the app has been used
 * before. An installation that has been used keeps the tour one tap away on Docs and in Settings →
 * About; what it does not get is a full-screen overlay it never asked for after an update.
 */
export const shouldOfferTourOnLaunch = (state: TourState): boolean =>
  state.completedAt === null && state.skippedAt === null && !hasPriorAppState();

const TOUR_START_EVENT = "c64u-tour-start-request";

export interface TourStartRequest {
  /** Start at the device chapter, for the offer Home makes after a first connection. */
  readonly fromStepId?: string;
  /**
   * Last step of the run, inclusive. The offer Home makes after a first connection is for the steps
   * that needed a machine and nothing else: without an end the run carried on through the rest of
   * the tour, repeating what had already been seen.
   */
  readonly throughStepId?: string;
}

/**
 * Ask the tour to start. A module-level request rather than a prop: Docs, Settings, search and
 * Home's post-connection offer all raise it, and none of them owns the driver.
 */
export const requestTourStart = (request: TourStartRequest = {}): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TourStartRequest>(TOUR_START_EVENT, { detail: request }));
};

export const subscribeTourStart = (handler: (request: TourStartRequest) => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => handler((event as CustomEvent<TourStartRequest>).detail ?? {});
  window.addEventListener(TOUR_START_EVENT, listener);
  return () => window.removeEventListener(TOUR_START_EVENT, listener);
};
