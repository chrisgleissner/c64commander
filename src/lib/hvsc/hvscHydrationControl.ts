/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// HARD19-019: a monotonically increasing generation that invalidates any
// in-flight HVSC metadata hydration. Hydration runs for minutes on a real
// ~60k-song library, holds a pre-reset snapshot object, and has no other
// cancellation signal — so a "Reset HVSC" (or a reinstall/update) mid-hydration
// would otherwise let a "zombie" hydrator keep issuing failing native reads,
// stamp survivors permanently "error", and re-persist the deleted/stale browse
// index — resurrecting the reset or clobbering a fresh reinstall.
//
// Reset and ingestion start bump the generation; `hydrateHvscMetadata` checks
// `shouldContinue()` per chunk and `ensureHvscMetadataHydration` guards every
// snapshot persist against the generation captured when the run began.
let hydrationGeneration = 0;

/** Invalidate any in-flight hydration. Returns the new generation. */
export const invalidateHvscHydration = () => {
  hydrationGeneration += 1;
  return hydrationGeneration;
};

/** The current hydration generation. A run is stale once this changes. */
export const getHvscHydrationGeneration = () => hydrationGeneration;

/** Test-only: reset the generation counter between cases. */
export const __resetHvscHydrationGenerationForTests = () => {
  hydrationGeneration = 0;
};
