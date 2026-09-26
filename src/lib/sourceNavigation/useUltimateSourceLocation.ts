/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";

import { inferConnectedDeviceLabel } from "@/lib/diagnostics/targetDisplayMapper";
import { createUltimateSourceLocation } from "./ftpSourceAdapter";
import { connectedDeviceLabel } from "./sourceTerms";
import type { SourceLocation } from "./types";

/** The Ultimate source is named after the connected product ("U64E", "U2"), and "C64U" only when that is unknown. */
export const resolveUltimateSourceName = (product?: string | null): string =>
  connectedDeviceLabel(inferConnectedDeviceLabel(product));

export const useUltimateSourceLocation = (product: string | null | undefined, isAvailable: boolean): SourceLocation => {
  const name = resolveUltimateSourceName(product);
  return useMemo(() => ({ ...createUltimateSourceLocation({ name }), isAvailable }), [name, isAvailable]);
};
