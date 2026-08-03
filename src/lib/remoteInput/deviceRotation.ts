/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DeviceRotation } from "@/lib/remoteInput/joystickKeyBindings";

/** Android's `OrientationEventListener.ORIENTATION_UNKNOWN` — the handset is flat. */
export const ORIENTATION_UNKNOWN = -1;

/**
 * How far past a sector boundary the chassis must travel before the mapping
 * follows it. Without this a handset held near 45°, or turned slowly, alternates
 * between two mappings and the player cannot predict which direction a key gives.
 */
export const ROTATION_HYSTERESIS_DEGREES = 20;

/** How long a new quantised value must hold before it is published (spec §4.3). */
export const ROTATION_DWELL_MS = 250;

const SECTOR_HALF_WIDTH = 45;

const circularDistance = (a: number, b: number): number => {
  const delta = Math.abs(((a - b) % 360) + 360) % 360;
  return Math.min(delta, 360 - delta);
};

const nearestSector = (degrees: number): DeviceRotation => ((Math.round(degrees / 90) % 4) * 90) as DeviceRotation;

/**
 * Snaps a raw chassis angle to one of the four upright orientations, keeping
 * `previous` inside the hysteresis band and whenever the handset is flat.
 */
export const quantiseRotation = (degrees: number, previous: DeviceRotation): DeviceRotation => {
  if (!Number.isFinite(degrees) || degrees === ORIENTATION_UNKNOWN || degrees < 0) return previous;
  const normalised = ((degrees % 360) + 360) % 360;
  if (circularDistance(normalised, previous) <= SECTOR_HALF_WIDTH + ROTATION_HYSTERESIS_DEGREES) return previous;
  return nearestSector(normalised);
};

/**
 * How far the app's rendered frame appears turned away from upright to the
 * player. The mirror is counter-rotated by this, while the KEYS are permuted by
 * the chassis rotation alone — the two differ only when the user has let the
 * layout rotate as well.
 */
export const frameRotation = (device: DeviceRotation, windowRotation: DeviceRotation): DeviceRotation =>
  ((device - windowRotation + 360) % 360) as DeviceRotation;

const COS: Record<DeviceRotation, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Record<DeviceRotation, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };

export interface PlanarVector {
  readonly x: number;
  readonly y: number;
}

/**
 * Maps a client-space delta into the stage's own unrotated frame, so a drag along
 * the axis the player sees pans the picture along the axis it belongs to. CSS
 * convention, `+y` down: `R(θ)·(x, y) = (x·cos θ − y·sin θ, x·sin θ + y·cos θ)`.
 *
 * Without this, pinch-to-zoom keeps the wrong focal point and one-finger drag
 * pans sideways — visible only once the handset is turned.
 */
export const unrotateDelta = (dx: number, dy: number, theta: DeviceRotation): PlanarVector => ({
  x: dx * COS[theta] - dy * SIN[theta],
  y: dx * SIN[theta] + dy * COS[theta],
});

export const unrotatePoint = (
  clientX: number,
  clientY: number,
  centre: PlanarVector,
  theta: DeviceRotation,
): PlanarVector => unrotateDelta(clientX - centre.x, clientY - centre.y, theta);

export interface StageFit {
  readonly width: number;
  readonly height: number;
}

/**
 * The stage's own UNROTATED size: the largest box of the frame's aspect whose
 * on-screen bounding box still fits the measured container. At 90° and 270° that
 * bounding box has the reciprocal aspect, which is what lets a turned picture use
 * the width it has just gained.
 */
export const fitStageSize = (
  containerWidth: number,
  containerHeight: number,
  frameAspect: number,
  rotation: DeviceRotation,
): StageFit => {
  if (containerWidth <= 0 || containerHeight <= 0 || frameAspect <= 0) return { width: 0, height: 0 };
  const quarterTurned = rotation === 90 || rotation === 270;
  const aspect = quarterTurned ? 1 / frameAspect : frameAspect;
  const width = Math.min(containerWidth, containerHeight * aspect);
  const height = Math.min(containerHeight, containerWidth / aspect);
  return quarterTurned ? { width: height, height: width } : { width, height };
};
