/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import {
  getLocalSourceListingMode,
  requireLocalSourceEntries,
  type LocalSourceEntry,
  type LocalSourceRecord,
} from "@/lib/sourceNavigation/localSourcesStore";

/** The entries of a local source that lists by entries, or null when it lists another way or its entries are unusable. */
export const readLocalSourceEntries = (
  localSource: LocalSourceRecord | null | undefined,
  context: string,
  failureMessage: string,
): LocalSourceEntry[] | null => {
  if (!localSource || getLocalSourceListingMode(localSource) !== "entries") return null;
  try {
    return requireLocalSourceEntries(localSource, context);
  } catch (error) {
    addErrorLog(failureMessage, {
      sourceId: localSource.id,
      error: {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    });
    return null;
  }
};
