/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** The five install steps, in the order they run. */
export type HvscStageId = "download" | "unpack" | "scan" | "details" | "analyze";

export const HVSC_STAGE_ORDER: HvscStageId[] = ["download", "unpack", "scan", "details", "analyze"];

/**
 * Which step a raw progress stage belongs to.
 *
 * The stage vocabulary is the native ingestion runtime's, and is finer-grained than anything worth
 * showing: `archive_validation` and `archive_extraction` are both "unpacking" as far as the user is
 * concerned, and `songlengths`, `sid_metadata_parsing` and `database_insertion` are all "reading the
 * details of each song". The hydration pass that follows the install is its own step, with its own
 * counter and clock.
 */
const STAGE_TO_STEP: Record<string, HvscStageId> = {
  download: "download",
  archive_validation: "unpack",
  archive_extraction: "unpack",
  sid_enumeration: "scan",
  songlengths: "details",
  sid_metadata_parsing: "details",
  // The hydration pass reports under its own name. Leaving it unmapped showed "Unpack" as the running
  // step for the whole of it — observed on the device, stuck there for minutes while the panel below
  // plainly read "HVSC META 128/61,157".
  sid_metadata_hydration: "analyze",
  database_insertion: "details",
};

export const stepForStage = (stage: string | null | undefined): HvscStageId | null =>
  stage ? (STAGE_TO_STEP[stage] ?? null) : null;
