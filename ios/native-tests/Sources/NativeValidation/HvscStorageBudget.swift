/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * Mirror of the two decisions `HvscIngestionPlugin.getStorageBudget` makes (HARD27-028).
 *
 * The app target is not importable from this package, so the logic is duplicated here the way
 * `FtpRequestNormalization` mirrors request normalisation. The behavioural cases in
 * `HvscStorageBudgetTests` run against this copy; the source assertions in the same file read the
 * app file directly, so the copy cannot pass while the app has drifted away from it.
 */
public enum HvscStorageBudget {

    /// Picks the free-space figure to report to the JavaScript pre-flight check.
    ///
    /// `volumeAvailableCapacityForImportantUsage` is preferred because it counts space iOS would
    /// reclaim by purging caches for a download the user asked for, which is what an HVSC install
    /// is. It is unavailable on some volumes, so `volumeAvailableCapacity` is the fallback.
    ///
    /// A non-positive or absent figure resolves to 0, and `ensureRoomForHvscInstall` skips the
    /// check on 0 rather than refusing. A false refusal costs the user the whole feature; a missed
    /// one costs a retry.
    public static func availableBytes(
        importantUsageCapacity: Int64?,
        volumeAvailableCapacity: Int?
    ) -> Int {
        if let important = importantUsageCapacity, important > 0 { return Int(important) }
        if let available = volumeAvailableCapacity, available > 0 { return available }
        return 0
    }

    /// Reports whether a previous library is resident. It is a diagnostic the JavaScript
    /// pre-flight check logs, not a multiplier: the free-space figure already excludes the
    /// resident library, so only the tree the extractor is about to write has to fit.
    ///
    /// Emptiness rather than existence is the test because `resolveLibraryRoot()` creates
    /// `hvsc/library` unconditionally before extraction starts, so the directory outlives an
    /// install that was killed before it wrote anything and its presence alone is not evidence of
    /// a library. Android's `getStorageBudget` tests `isDirectory` instead; the difference is in
    /// how the two plugins create the directory, not in what the figure is supposed to mean.
    public static func libraryPresent(entries: [String]?) -> Bool {
        guard let entries else { return false }
        return !entries.isEmpty
    }
}
