/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { subscribeSearchOpen, type SearchOpenRequest } from "@/lib/search/overlayState";

/**
 * Listens for an open request and loads the overlay the first time one arrives.
 *
 * The overlay reaches the archive search, the disk store and the config cache, which puts the whole
 * HVSC library in whatever chunk it lands in. Mounted eagerly at the app root that chunk is the
 * index bundle: the measured cost was 54.6 KB gzipped, taking it 33.8 KB past the 250 KB budget,
 * and every launch paid for parsing code that most launches never run. Behind `lazy` it is its own
 * chunk, fetched on the first search and never before.
 */
const SearchOverlay = lazy(() => import("@/components/search/SearchOverlay"));

export const SearchOverlayHost = () => {
  const [request, setRequest] = useState<SearchOpenRequest | null>(null);

  useEffect(() => subscribeSearchOpen(setRequest), []);

  if (request === null) return null;

  return (
    <Suspense fallback={null}>
      <SearchOverlay request={request} onClose={() => setRequest(null)} />
    </Suspense>
  );
};
