/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const MIN_FITTED_CONTROL_PX = 96;

export type JoystickFitInput = {
  controlPx: number;
  firePx: number;
  gapPx: number;
  sideMinPx?: number;
  availableWidthPx: number;
  availableHeightPx: number;
};

export type JoystickFit = { controlPx: number; firePx: number };

const isMeasured = (value: number) => Number.isFinite(value) && value > 0;

/**
 * Shrinks the movement control and FIRE together, keeping their proportion, until both fit the
 * space the sheet leaves them side by side. The column beside the stick is never narrower than
 * `sideMinPx`, whatever the size of FIRE. Never grows them, and leaves them alone while the
 * space is unmeasured.
 */
export const fitJoystickControls = ({
  controlPx,
  firePx,
  gapPx,
  sideMinPx = 0,
  availableWidthPx,
  availableHeightPx,
}: JoystickFitInput): JoystickFit => {
  let factor = 1;
  if (isMeasured(availableWidthPx)) {
    const proportional = (availableWidthPx - gapPx) / (controlPx + firePx);
    const sideLimited = (availableWidthPx - gapPx - sideMinPx) / controlPx;
    factor = Math.min(factor, firePx * proportional >= sideMinPx ? proportional : sideLimited);
  }
  if (isMeasured(availableHeightPx)) factor = Math.min(factor, availableHeightPx / controlPx);
  if (factor >= 1) return { controlPx, firePx };
  const fittedControlPx = Math.max(MIN_FITTED_CONTROL_PX, Math.floor(controlPx * factor));
  return { controlPx: fittedControlPx, firePx: Math.floor((firePx * fittedControlPx) / controlPx) };
};
