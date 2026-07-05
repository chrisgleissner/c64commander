/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback } from "react";
import { useC64SetConfig } from "@/hooks/useC64Connection";
import { canonicalConfigKey, type AuthoritativeConfigValueState } from "@/hooks/useAuthoritativeConfigValueState";
import { toast } from "@/hooks/use-toast";
import { reportUserError } from "@/lib/uiErrors";

/**
 * Single-item Config write, shared by the menu-page and fallback leaf renderers.
 *
 * Always writes the canonical REST `{category, item}` (preserved end-to-end) via
 * `useC64SetConfig` → `setConfigValue` → PUT (single-item writes MUST stay PUT — POST
 * buffers to a tempfile and kills the device network stack). Pins an optimistic value
 * in the page-shared authoritative store keyed by `canonicalConfigKey`, and restores it
 * on failure. This is the same contract as the legacy `CategorySection.handleValueChange`.
 */
export const useConfigLeafWrite = (authoritativeValues: AuthoritativeConfigValueState, markChanged: () => void) => {
  const setConfig = useC64SetConfig();

  const writeLeaf = useCallback(
    async (category: string, item: string, value: string | number): Promise<boolean> => {
      const key = canonicalConfigKey(category, item);
      const previousEntry = authoritativeValues.entriesRef.current[key];
      authoritativeValues.replaceEntry(key, value);
      try {
        await setConfig.mutateAsync({ category, item, value });
        markChanged();
        toast({ title: `${item} updated` });
        return true;
      } catch (error) {
        reportUserError({
          operation: "CONFIG_UPDATE",
          title: "Error",
          description: (error as Error).message,
          error,
          context: { category, item },
        });
        authoritativeValues.restoreEntry(key, previousEntry, value);
        return false;
      }
    },
    [authoritativeValues, markChanged, setConfig],
  );

  return { writeLeaf, isWriting: setConfig.isPending };
};
