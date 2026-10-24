/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useSyncExternalStore } from "react";

import { getInputModality, subscribeInputModality, type InputModality } from "@/lib/input/inputModality";

/** Whether the person last acted with navigation keys or with a pointer, kept current as it changes. */
export const useInputModality = (): InputModality =>
  useSyncExternalStore(subscribeInputModality, getInputModality, getInputModality);
