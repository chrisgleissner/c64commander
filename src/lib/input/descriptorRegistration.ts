/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { FocusDescriptor } from "@/lib/input";
import { isOnActivePage } from "@/lib/navigation/activePage";

export type DescriptorRegistration = { descriptor: FocusDescriptor; resolveElement: () => HTMLElement | null };

/**
 * One registration per id reaches the ring. Two can share an id where the same control is on two pages, such as a
 * config row on Config and in Play's override editor; kept pages hold both at once. The one on the page on screen
 * wins, else the latest, and ending one leaves the other in place.
 */
export const pickRegistration = (registrations: readonly DescriptorRegistration[]): DescriptorRegistration => {
  if (registrations.length === 1) return registrations[0];
  for (let index = registrations.length - 1; index >= 0; index -= 1) {
    const element = registrations[index].resolveElement();
    if (element !== null && isOnActivePage(element)) return registrations[index];
  }
  return registrations[registrations.length - 1];
};
