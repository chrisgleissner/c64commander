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
  streamHvscSongsRecursive,
  getHvscStatus,
  ingestCachedHvsc,
  installOrUpdateHvsc,
  isHvscBridgeAvailable,
  resolveHvscSonglength,
} from "./hvscService";
export { recoverStaleIngestionState } from "./hvscIngestionRuntime";
export { createHvscMediaIndex, HvscMediaIndexAdapter } from "./hvscMediaIndex";
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
