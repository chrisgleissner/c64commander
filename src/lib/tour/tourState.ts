/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";

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

/** True on a first launch: neither finished nor abandoned, so the tour has never been offered. */
export const shouldOfferTourOnLaunch = (state: TourState): boolean =>
  state.completedAt === null && state.skippedAt === null;

const TOUR_START_EVENT = "c64u-tour-start-request";

export interface TourStartRequest {
  /** Start at the device chapter, for the offer Home makes after a first connection. */
  readonly fromStepId?: string;
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
