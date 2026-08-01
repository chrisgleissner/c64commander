/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type {
  HvscCacheStatus,
  HvscFolderListing,
  HvscFolderListingPage,
  HvscIngestionState,
  HvscIngestionSummary,
  HvscProgressEvent,
  HvscSong,
  HvscStatus,
  HvscUpdateStatus,
} from "./hvscTypes";
export {
  addHvscProgressListener,
  cancelHvscInstall,
  checkForHvscUpdates,
  getHvscCacheStatus,
  getHvscDurationByMd5Seconds,
  getHvscDurationsByMd5Seconds,
  getHvscFolderListing,
  getHvscFolderListingPaged,
  ensureHvscMetadataHydration,
  getHvscSong,
  getHvscSongsRecursive,
  getHvscSubsongDurationsSeconds,
  getHvscSubsongTitles,
  streamHvscSongsRecursive,
  getHvscStatus,
  ingestCachedHvsc,
  installOrUpdateHvsc,
  isHvscBridgeAvailable,
  isHvscIngestionBridgeAvailable,
  resetHvscLibraryData,
  resolveHvscSonglength,
  searchHvscSongs,
} from "./hvscService";
export { recoverStaleIngestionState } from "./hvscIngestionRuntime";
export { decodeStilText, parseStil, primaryCredit, stilInfoForSubsong, stripSectionTimestamp } from "./stilParser";
export type { StilCredit, StilEntry, StilInfo } from "./stilParser";
export { clearStil, getStilEntry, getStilInfo, isStilInstalled, readStilManifest } from "./stilStore";
export { ensureStilReady } from "./stilService";
export { createHvscMediaIndex, HvscMediaIndexAdapter } from "./hvscMediaIndex";
export { describeHvscPreparationTransition, resolveHvscPreparationSnapshot } from "./hvscPreparationState";
export type {
  HvscPreparationPhase,
  HvscPreparationSnapshot,
  HvscPreparationState,
  HvscPreparationStateInput,
} from "./hvscPreparationState";
export { clearHvscRoot, getDefaultHvscRoot, loadHvscRoot, saveHvscRoot } from "./hvscRootLocator";
export {
  clearHvscStatusSummary,
  getDefaultHvscStatusSummary,
  loadHvscStatusSummary,
  saveHvscStatusSummary,
} from "./hvscStatusStore";
export type {
  HvscDownloadStatus,
  HvscExtractionStatus,
  HvscFailureCategory,
  HvscMetadataHydrationStatus,
  HvscStatusSummary,
  HvscStepStatus,
} from "./hvscStatusStore";
export { HvscSongSource } from "./hvscSource";
export { createHvscCancellationError, HVSC_CANCELLATION_CODE, isHvscCancellationError } from "./hvscCancellation";
