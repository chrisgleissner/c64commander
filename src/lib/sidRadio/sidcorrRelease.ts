/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Pinned SID Radio similarity bundle (sidcorr-tiny-1) release coordinates.
 *
 * The Tiny similarity export ships as a bundled web asset, fetched at build
 * time by `scripts/fetch-sidcorr.mjs` (never committed to git — see .gitignore).
 * These constants are the single app-facing source of truth for the pin; the
 * build script keeps its own `SIDCORR_RELEASE` copy and a test asserts the two
 * never drift (`tests/unit/scripts/fetchSidcorr.test.ts`).
 *
 * Refresh cadence is decoupled from HVSC updates (spec D4/D9): re-pin only when
 * a newer `sidflow-data` release is adopted, updating the tag + sha256 here.
 */

/** GitHub repo hosting the published similarity exports. */
export const SIDCORR_REPO = "chrisgleissner/sidflow-data";

/** Release tag the bundle is pinned to. */
export const SIDCORR_RELEASE_TAG = "0.8.0";

/** Release asset name for the Tiny bundle. */
export const SIDCORR_BUNDLE_ASSET = "sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr";

/** Release asset name for the Tiny manifest. */
export const SIDCORR_MANIFEST_ASSET = "sidcorr-hvsc-full-sidcorr-tiny-1.manifest.json";

/**
 * Committed sha256 of the pinned bundle. A build fails loudly if the fetched
 * asset drifts from this pin (spec §3).
 */
export const SIDCORR_BUNDLE_SHA256 = "64bee4464c89f605ea15e468168ff39b9f00bb8bf659da2af59ad0004f7c9c6d";

/**
 * Path under `public/` where the fetched bundle lands. Vite copies `public/`
 * into `dist/`, and Capacitor copies `dist/` into the native asset bundle, so
 * the app fetches it from the web root at runtime (see {@link SIDCORR_BUNDLE_URL}).
 */
export const SIDCORR_BUNDLE_PUBLIC_PATH = "data/sidcorr/hvsc-tiny.sidcorr";

/** Runtime fetch URL for the bundled asset (served from the web root). */
export const SIDCORR_BUNDLE_URL = `/${SIDCORR_BUNDLE_PUBLIC_PATH}`;

/** Schema id of the export format (see sidflow doc/similarity-export-tiny.md). */
export const SIDCORR_SCHEMA_VERSION = "sidcorr-tiny-1";

/** Binary layout version currently produced by the generator (v2). */
export const SIDCORR_BINARY_FORMAT_VERSION = 2;

/**
 * Manifest counts for the pinned release, used by the opt-in `SIDCORR_REAL=1`
 * golden test to assert the parser round-trips the real bundle (spec §7 M0).
 */
export const SIDCORR_EXPECTED = {
  fileCount: 61157,
  trackCount: 87868,
  neighborsPerTrack: 3,
  styleCount: 9,
} as const;
