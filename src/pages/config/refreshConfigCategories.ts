/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { QueryClient } from "@tanstack/react-query";

export type ConfigCategoryRefreshFailure = { category: string; error: unknown };

/**
 * Re-reads each category from the device and drops its optimistic pins only once that read
 * succeeded. A failed read leaves the cached values in place, so dropping the pins then would show
 * stale values as if they were the device's (HARD9-089). Returns the categories that failed.
 */
export const refreshConfigCategories = async (
  queryClient: QueryClient,
  categories: readonly string[],
  clearCategoryPins: (prefix: string) => void,
): Promise<ConfigCategoryRefreshFailure[]> => {
  const failures: ConfigCategoryRefreshFailure[] = [];
  await Promise.all(
    categories.map(async (category) => {
      try {
        await queryClient.invalidateQueries({ queryKey: ["c64-category", category] }, { throwOnError: true });
        clearCategoryPins(`${category}::`);
      } catch (error) {
        failures.push({ category, error });
      }
    }),
  );
  return failures;
};
