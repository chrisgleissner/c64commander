/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import { useC64Categories } from "@/hooks/useC64Connection";

type CategoryQueryOptions = Parameters<typeof useC64Categories>[0];

/**
 * The category list of the connected device. While the query still holds the list of the previous device as
 * placeholder data, the list is empty and the result is loading, so nothing is read from the new device by
 * names it may not have.
 */
export const useLiveConfigCategories = (options: CategoryQueryOptions) => {
  const query = useC64Categories(options);
  const isFromPreviousRouting = Boolean(query.isPlaceholderData);
  const categories = useMemo(
    () => (isFromPreviousRouting ? [] : (query.data?.categories ?? [])),
    [isFromPreviousRouting, query.data],
  );
  return {
    liveCategories: categories,
    hasList: Boolean(query.data?.categories),
    isLoading: query.isLoading || isFromPreviousRouting,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
