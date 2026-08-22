/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Whether Live View draws the focus reticle around whatever the view is locked on to.
 *
 * On by default, and for the reason a camera draws one: the picture alone cannot say WHICH
 * object the view decided to follow, so without it a lock on the wrong sprite looks exactly
 * like a lock on the right one. It is a setting rather than a fixture because the reticle is
 * drawn over a game the user is playing, and on the smallest screens that is a real cost.
 */

const RETICLE_KEY = "c64u_follow_reticle";

export const DEFAULT_FOLLOW_RETICLE = true;

export const loadFollowReticle = (): boolean => {
  if (typeof localStorage === "undefined") return DEFAULT_FOLLOW_RETICLE;
  const raw = localStorage.getItem(RETICLE_KEY);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return DEFAULT_FOLLOW_RETICLE;
};

/** Announced on every change, so a Live View that is already on screen follows it at once. */
export const FOLLOW_RETICLE_CHANGE_EVENT = "c64u-follow-reticle-changed";

export const saveFollowReticle = (enabled: boolean): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(RETICLE_KEY, enabled ? "1" : "0");
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FOLLOW_RETICLE_CHANGE_EVENT));
};

/** Subscribe to changes made in Settings while Live View is open. Returns an unsubscribe. */
export const subscribeFollowReticle = (handler: (enabled: boolean) => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const notify = () => handler(loadFollowReticle());
  window.addEventListener(FOLLOW_RETICLE_CHANGE_EVENT, notify);
  return () => window.removeEventListener(FOLLOW_RETICLE_CHANGE_EVENT, notify);
};
