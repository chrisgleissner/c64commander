/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { JoystickInputName } from "@/lib/c64api";

export type SwipeGestureSample = {
  dx: number;
  dy: number;
  durationMs: number;
};

/** Below this distance, a touch is a tap/jitter, not a directional swipe. */
export const SWIPE_MIN_DISTANCE_PX = 24;
/** Above this duration, it is a slow drag (the stick/D-pad's own job), not a quick flick. */
export const SWIPE_MAX_DURATION_MS = 300;
/**
 * A swipe-triggered direction must stay held at least this long before
 * auto-releasing - longer than the transport's ~40ms coalescing window, or a
 * genuinely fast flick's press+release would fold into the SAME flush as a
 * net no-op and never reach the device at all.
 */
export const SWIPE_TAP_HOLD_MS = 120;

/**
 * Resolves a completed swipe gesture (measured from pointerdown to
 * pointerup) to the joystick direction(s) it represents, or an empty array
 * when the gesture was too small/slow to count as an intentional swipe
 * (falls through to being treated as a tap or ignored jitter).
 */
export const resolveSwipeDirections = (sample: SwipeGestureSample): JoystickInputName[] => {
  const distance = Math.hypot(sample.dx, sample.dy);
  if (distance < SWIPE_MIN_DISTANCE_PX || sample.durationMs > SWIPE_MAX_DURATION_MS) return [];
  const angle = Math.atan2(sample.dy, sample.dx);
  const directions: JoystickInputName[] = [];
  if (Math.cos(angle) > 0.35) directions.push("right");
  else if (Math.cos(angle) < -0.35) directions.push("left");
  if (Math.sin(angle) > 0.35) directions.push("down");
  else if (Math.sin(angle) < -0.35) directions.push("up");
  return directions;
};
