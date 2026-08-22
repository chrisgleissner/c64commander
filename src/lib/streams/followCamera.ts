/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Live View — the camera that carries the follow viewport.
 *
 * A viewport that jumps to each measured centroid is unusable: a walking sprite's centroid
 * wobbles a pixel or two every frame and the whole picture shakes. A viewport that merely
 * lags is unusable too — the thing being followed sits behind the centre whenever it moves.
 *
 * This is first-order exponential smoothing with velocity feed-forward: the camera eases
 * toward where the subject WILL be, not where it was. With `lookaheadMs` equal to `tauMs`
 * the steady-state lag for a constant velocity is exactly zero; the default is slightly
 * under, so a sudden stop settles rather than overshoots. Pure math, no React, no DOM.
 */

export interface FollowCameraAim {
  x: number;
  y: number;
  /** Normalized frame widths/heights per second. */
  vx: number;
  vy: number;
}

export interface FollowCameraOptions {
  /** Smoothing time constant, ms. Larger is calmer and slower. */
  tauMs?: number;
  /** How far ahead of the subject the camera aims, in ms of its own velocity. */
  lookaheadMs?: number;
  /** Aim offsets under this (normalized) distance are ignored, killing centroid jitter. */
  deadzone?: number;
  /** Camera speed cap, normalized frame widths per second. */
  maxSpeedPerSec?: number;
  /**
   * Beyond this (normalized) distance the camera JUMPS instead of travelling. Smoothing is for
   * motion; a respawn, a screen exit or a room change is not motion, and gliding across the
   * frame after one means seconds of watching scenery the player has already left.
   */
  snapDistance?: number;
}

const DEFAULTS: Required<FollowCameraOptions> = {
  tauMs: 140,
  lookaheadMs: 120,
  deadzone: 0,
  maxSpeedPerSec: 2.5,
  snapDistance: 0,
};

/**
 * The camera centre after `dtMs`, given where the subject is and how fast it is going.
 * Both the returned centre and `aim` are normalized frame coords; clamping into the frame is
 * the viewport's job (`mirrorViewport.setCenter`), so it stays in one place.
 */
export const advanceFollowCamera = (
  current: { x: number; y: number },
  aim: FollowCameraAim,
  dtMs: number,
  options: FollowCameraOptions = {},
): { x: number; y: number } => {
  const { tauMs, lookaheadMs, deadzone, maxSpeedPerSec, snapDistance } = { ...DEFAULTS, ...options };
  if (!Number.isFinite(aim.x) || !Number.isFinite(aim.y)) return current;

  const dt = Math.min(Math.max(Number.isFinite(dtMs) ? dtMs : 0, 0), 500) / 1000;
  if (dt <= 0) return current;

  // Judged on the raw aim, not the fed-forward one: right after a teleport the velocity is
  // whatever the tracker last believed, and it is not evidence about where to point the camera.
  if (snapDistance > 0) {
    const jumpX = aim.x - current.x;
    const jumpY = aim.y - current.y;
    if (Math.sqrt(jumpX * jumpX + jumpY * jumpY) > snapDistance) return { x: aim.x, y: aim.y };
  }

  const vx = Number.isFinite(aim.vx) ? aim.vx : 0;
  const vy = Number.isFinite(aim.vy) ? aim.vy : 0;
  let dx = aim.x + (vx * lookaheadMs) / 1000 - current.x;
  let dy = aim.y + (vy * lookaheadMs) / 1000 - current.y;

  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance <= deadzone) return current;
  // Pull the aim back to the edge of the deadzone rather than dropping it entirely: the camera
  // then settles ON the edge instead of hunting between "inside, ignore" and "outside, chase".
  if (deadzone > 0) {
    const keep = (distance - deadzone) / distance;
    dx *= keep;
    dy *= keep;
  }

  const alpha = 1 - Math.exp(-(dt * 1000) / Math.max(tauMs, 1));
  let stepX = dx * alpha;
  let stepY = dy * alpha;
  const stepLength = Math.sqrt(stepX * stepX + stepY * stepY);
  const maxStep = maxSpeedPerSec * dt;
  if (stepLength > maxStep && stepLength > 0) {
    const scale = maxStep / stepLength;
    stepX *= scale;
    stepY *= scale;
  }

  return { x: current.x + stepX, y: current.y + stepY };
};
