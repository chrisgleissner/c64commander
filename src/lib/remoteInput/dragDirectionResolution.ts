/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { JoystickInputName } from "@/lib/c64api";

/** Displacement past this fraction of the reference radius resolves to a direction (generous dead zone). */
export const DRAG_DEAD_ZONE_FRACTION = 0.25;

/**
 * Resolves a LIVE drag displacement (dx, dy from wherever the drag started)
 * into the 0-2 joystick directions it currently represents (8-way: an axis
 * fires once its component passes a ~20-degree threshold), given a reference
 * radius that scales the dead zone. Shared by every drag-based joystick
 * control (the Analog stick's fixed-radius knob and the Swipe pad's
 * unbounded surface) so both follow the exact same direction model.
 */
export const resolveDragDirections = (dx: number, dy: number, radius: number): JoystickInputName[] => {
  const distance = Math.hypot(dx, dy);
  if (distance < radius * DRAG_DEAD_ZONE_FRACTION) return [];
  const angle = Math.atan2(dy, dx);
  const directions: JoystickInputName[] = [];
  if (Math.cos(angle) > 0.35) directions.push("right");
  else if (Math.cos(angle) < -0.35) directions.push("left");
  if (Math.sin(angle) > 0.35) directions.push("down");
  else if (Math.sin(angle) < -0.35) directions.push("up");
  return directions;
};
