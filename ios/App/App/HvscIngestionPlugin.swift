/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import Foundation
import Capacitor
import SQLite3
import SWCompression

// MARK: - HvscIngestionPlugin

/// Native iOS implementation of the HvscIngestion Capacitor plugin.
///
/// Responsibilities:
/// - `readArchiveChunk`: read raw bytes from a .7z archive stored in the app's Documents directory,
///   allowing JavaScript to assemble the full archive buffer for non-native ingestion.
/// - `ingestHvsc`: full native ingestion path — extracts the 7z archive with SWCompression,
///   writes .sid and songlength files to the library directory, and builds the metadata
///   SQLite index used by the HVSC browse view.
/// - `cancelIngestion`, `getIngestionStats`: lifecycle helpers.
///
/// The JS layer (`hvscIngestionRuntime.ts`) now selects the native ingestion path whenever the
/// `HvscIngestion` plugin is available on a native platform, so `ingestHvsc` is part of the
/// active iOS production path. `readArchiveChunk` remains available for recovery and non-native
/// fallback flows.
@objc(HvscIngestionPlugin)
public final class HvscIngestionPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "HvscIngestionPlugin"
    public let jsName = "HvscIngestion"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "readArchiveChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ingestHvsc", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelIngestion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getIngestionStats", returnType: CAPPluginReturnPromise),
    ]

    private let ioQueue = DispatchQueue(label: "uk.gleissner.c64commander.hvscing", qos: .utility)
    private let cancellationLock = NSLock()
    private var _cancellationRequested = false
    private var cancellationRequested: Bool {
        get { cancellationLock.withLock { _cancellationRequested } }
        set { cancellationLock.withLock { _cancellationRequested = newValue } }
    }

    // MARK: - readArchiveChunk

    /// Read `lengthBytes` raw bytes from the archive starting at `offsetBytes`.
    /// Returns base64-encoded data. This is the only method called by the JS layer
    /// on iOS to assemble the full archive buffer for the non-native 7z-wasm ingestion path.
    @objc public func readArchiveChunk(_ call: CAPPluginCall) {
        guard let relativeArchivePath = call.getString("relativeArchivePath"),
              !relativeArchivePath.isEmpty else {
            call.reject("relativeArchivePath is required")
            return
        }

        // Distinguish absent field (nil) from zero (0) using the raw options dictionary.
        guard let offsetBytesRaw = call.options?["offsetBytes"] else {
            call.reject("offsetBytes is required")
            return
        }
        let offsetBytes: Int64
        if let n = offsetBytesRaw as? NSNumber {
            offsetBytes = n.int64Value
        } else {
            call.reject("offsetBytes must be a number")
            return
        }
        guard offsetBytes >= 0 else {
            call.reject("offsetBytes must be >= 0")
            return
        }
        guard let lengthBytes = call.getInt("lengthBytes"), lengthBytes > 0 else {
            call.reject("lengthBytes must be > 0")
            return
        }

        IOSDiagnostics.log(.debug, "HvscIngestion.readArchiveChunk", details: [
            "origin": "native",
            "offsetBytes": offsetBytes,
            "lengthBytes": lengthBytes,
            "path": relativeArchivePath,
        ])

        ioQueue.async {
            do {
                let archiveUrl = try self.resolveDocumentsUrl(relativePath: relativeArchivePath)
                let fileHandle = try FileHandle(forReadingFrom: archiveUrl)
                defer { try? fileHandle.close() }

                try fileHandle.seek(toOffset: UInt64(offsetBytes))
                let data = fileHandle.readData(ofLength: lengthBytes)

                let attrs = try FileManager.default.attributesOfItem(atPath: archiveUrl.path)
                let fileSize = (attrs[.size] as? Int64) ?? 0
                let eof = offsetBytes + Int64(data.count) >= fileSize

                call.resolve([
                    "data": data.base64EncodedString(),
                    "sizeBytes": data.count,
                    "eof": eof,
                ])
            } catch {
                IOSDiagnostics.log(.error, "HvscIngestion.readArchiveChunk failed",
                    details: ["origin": "native", "path": relativeArchivePath], error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: - ingestHvsc

    /// Full native ingestion: extract the 7z archive and write metadata to SQLite.
    ///
    /// The JS runtime now selects this native path whenever the `HvscIngestion` plugin is
    /// available on a native iOS build. The remaining gap is validation and memory scaling,
    /// not runtime reachability.
    @objc public func ingestHvsc(_ call: CAPPluginCall) {
        guard let relativeArchivePath = call.getString("relativeArchivePath"),
              !relativeArchivePath.isEmpty else {
            call.reject("relativeArchivePath is required")
            return
        }
        let mode = call.getString("mode") ?? "baseline"
        guard mode == "baseline" || mode == "update" else {
            call.reject("mode must be baseline or update")
            return
        }
        let resetLibrary = call.getBool("resetLibrary") ?? false
        let progressEvery = max(1, call.getInt("progressEvery") ?? 250)
        let dbBatchSize = max(1, call.getInt("dbBatchSize") ?? 500)
        let minExpectedRows = call.getInt("minExpectedRows") ?? 0

        cancellationRequested = false

        IOSDiagnostics.log(.info, "HvscIngestion.ingestHvsc starting", details: [
            "origin": "native", "mode": mode, "path": relativeArchivePath,
        ])

        ioQueue.async {
            do {
                let archiveUrl = try self.resolveDocumentsUrl(relativePath: relativeArchivePath)
                guard FileManager.default.fileExists(atPath: archiveUrl.path) else {
                    throw HvscError.operationFailed("Archive not found: \(archiveUrl.path)")
                }

                let libraryRoot = try self.resolveLibraryRoot()
                let db = try self.openDatabase()
                defer { sqlite3_close(db) }

                if resetLibrary {
                    try self.clearLibrary(libraryRoot: libraryRoot, db: db)
                }

                self.emitProgress(stage: "archive_extraction", message: "Loading archive…",
                    processedCount: 0, totalCount: nil, currentFile: nil,
                    songsIngested: 0, songsDeleted: 0)

                let archiveData = try Data(contentsOf: archiveUrl)
                let entries = try SevenZipContainer.open(container: archiveData)

                IOSDiagnostics.log(.info, "HvscIngestion: archive opened", details: [
                    "origin": "native", "entryCount": entries.count,
                ])

                var processedEntries = 0
                var songsIngested = 0
                var songsDeleted = 0
                var failedSongs = 0
                var failedPaths: [String] = []
                var songlengthFilesWritten = 0
                var metadataUpserts = 0
                var pendingUpserts: [[String: Any?]] = []
                var pendingDeletions: [String] = []

                for entry in entries {
                    if self.cancellationRequested {
                        call.reject("HVSC ingestion cancelled")
                        return
                    }

                    let rawPath = entry.info.name
                    guard entry.info.type != .directory,
                          !rawPath.isEmpty else {
                        processedEntries += 1
                        continue
                    }

                    let normalizedPath: String
                    if mode == "update" {
                        normalizedPath = Self.normalizeUpdateEntryPath(rawPath)
                    } else {
                        normalizedPath = Self.normalizeEntryPath(rawPath)
                    }
                    guard !normalizedPath.isEmpty else {
                        processedEntries += 1
                        continue
                    }

                    let lowered = normalizedPath.lowercased()

                    processedEntries += 1
                    if processedEntries % progressEvery == 0 {
                        self.emitProgress(
                            stage: "archive_extraction",
                            message: "Extracting…",
                            processedCount: processedEntries,
                            totalCount: entries.count,
                            currentFile: normalizedPath,
                            songsIngested: songsIngested,
                            songsDeleted: songsDeleted
                        )
                    }

                    guard let entryData = entry.data else {
                        processedEntries += 1
                        continue
                    }

                    let targetUrl = libraryRoot.appendingPathComponent(normalizedPath)
                    let parentDir = targetUrl.deletingLastPathComponent()
                    try FileManager.default.createDirectory(at: parentDir,
                        withIntermediateDirectories: true)

                    if Self.isDeletionList(normalizedPath) {
                        if let text = String(data: entryData, encoding: .utf8) {
                            pendingDeletions.append(contentsOf: Self.parseDeletionList(text))
                        }
                    } else if lowered.hasSuffix("songlengths.md5") || lowered.hasSuffix("songlengths.txt") {
                        try entryData.write(to: targetUrl, options: .atomic)
                        songlengthFilesWritten += 1
                    } else if lowered.hasSuffix(".sid") {
                        do {
                            try entryData.write(to: targetUrl, options: .atomic)
                            let header = Self.parseSidHeader(entryData)
                            let fileName = targetUrl.lastPathComponent
                            pendingUpserts.append([
                                "virtualPath": normalizedPath,
                                "fileName": fileName,
                                "songs": header?.songs,
                                "startSong": header?.startSong,
                            ])
                            songsIngested += 1

                            if pendingUpserts.count >= dbBatchSize {
                                let upsertCount = try self.flushUpserts(&pendingUpserts, db: db)
                                metadataUpserts += upsertCount
                            }
                        } catch {
                            failedSongs += 1
                            failedPaths.append(normalizedPath)
                            IOSDiagnostics.log(.warn, "HvscIngestion: failed to write SID",
                                details: ["origin": "native", "path": normalizedPath], error: error)
                        }
                    }
                }

                // Flush remaining upserts
                if !pendingUpserts.isEmpty {
                    let upsertCount = try self.flushUpserts(&pendingUpserts, db: db)
                    metadataUpserts += upsertCount
                }

                // Apply deletions
                if !pendingDeletions.isEmpty {
                    songsDeleted = try self.applyDeletions(pendingDeletions, libraryRoot: libraryRoot, db: db)
                }

                let metadataRows = self.getSongIndexCount(db)
                if metadataRows < minExpectedRows {
                    throw HvscError.operationFailed(
                        "HVSC metadata row count below threshold: \(metadataRows) < \(minExpectedRows)"
                    )
                }

                IOSDiagnostics.log(.info, "HvscIngestion.ingestHvsc complete", details: [
                    "origin": "native",
                    "songsIngested": songsIngested,
                    "songsDeleted": songsDeleted,
                    "failedSongs": failedSongs,
                    "metadataRows": metadataRows,
                    "songlengthFilesWritten": songlengthFilesWritten,
                ])

                call.resolve([
                    "totalEntries": processedEntries,
                    "songsIngested": songsIngested,
                    "songsDeleted": songsDeleted,
                    "failedSongs": failedSongs,
                    "failedPaths": failedPaths,
                    "songlengthFilesWritten": songlengthFilesWritten,
                    "metadataRows": metadataRows,
                    "metadataUpserts": metadataUpserts,
                    "metadataDeletes": songsDeleted,
                    "archiveBytes": 0,
                ])
            } catch {
                IOSDiagnostics.log(.error, "HvscIngestion.ingestHvsc failed",
                    details: ["origin": "native", "path": relativeArchivePath], error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: - cancelIngestion

    @objc public func cancelIngestion(_ call: CAPPluginCall) {
        cancellationRequested = true
        IOSDiagnostics.log(.info, "HvscIngestion.cancelIngestion requested", details: ["origin": "native"])
        call.resolve()
    }

    // MARK: - getIngestionStats

    @objc public func getIngestionStats(_ call: CAPPluginCall) {
        ioQueue.async {
            do {
                let db = try self.openDatabase()
                defer { sqlite3_close(db) }
                let count = self.getSongIndexCount(db)
                call.resolve(["metadataRows": count])
            } catch {
                IOSDiagnostics.log(.warn, "HvscIngestion.getIngestionStats failed",
                    details: ["origin": "native"], error: error)
                call.resolve(["metadataRows": 0])
            }
        }
    }

    // MARK: - Private helpers

    private func resolveDocumentsUrl(relativePath: String) throws -> URL {
        guard let docsDir = FileManager.default.urls(for: .documentDirectory,
                                                      in: .userDomainMask).first else {
            throw HvscError.operationFailed("Cannot resolve Documents directory")
        }
        let sanitized = try sanitizePath(relativePath)
        return docsDir.appendingPathComponent(sanitized)
    }

    private func resolveLibraryRoot() throws -> URL {
        guard let docsDir = FileManager.default.urls(for: .documentDirectory,
                                                      in: .userDomainMask).first else {
            throw HvscError.operationFailed("Cannot resolve Documents directory")
        }
        let root = docsDir.appendingPathComponent("hvsc/library", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func sanitizePath(_ input: String) throws -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let components = trimmed.split(separator: "/").map(String.init).filter { !$0.isEmpty }
        guard !components.contains("..") else {
            throw HvscError.invalidArgument("path must not contain parent traversal")
        }
        return components.joined(separator: "/")
    }

    private func clearLibrary(libraryRoot: URL, db: OpaquePointer) throws {
        if FileManager.default.fileExists(atPath: libraryRoot.path) {
            try FileManager.default.removeItem(at: libraryRoot)
        }
        try FileManager.default.createDirectory(at: libraryRoot, withIntermediateDirectories: true)
        let sql = "DELETE FROM hvsc_song_index"
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw HvscError.operationFailed("Failed to prepare DELETE: \(String(cString: sqlite3_errmsg(db)))")
        }
        guard sqlite3_step(stmt) == SQLITE_DONE else {
            throw HvscError.operationFailed("Failed to clear song index: \(String(cString: sqlite3_errmsg(db)))")
        }
    }

    private func emitProgress(
        stage: String,
        message: String,
        processedCount: Int?,
        totalCount: Int?,
        currentFile: String?,
        songsIngested: Int,
        songsDeleted: Int
    ) {
        var data: [String: Any] = [
            "stage": stage,
            "message": message,
            "songsUpserted": songsIngested,
            "songsDeleted": songsDeleted,
        ]
        if let processed = processedCount { data["processedCount"] = processed }
        if let total = totalCount { data["totalCount"] = total }
        if let file = currentFile { data["currentFile"] = file }
        notifyListeners("hvscProgress", data: data)
    }

    private func flushUpserts(_ rows: inout [[String: Any?]], db: OpaquePointer) throws -> Int {
        let sql = """
            INSERT OR REPLACE INTO hvsc_song_index
                (virtual_path, file_name, songs, start_song, updated_at_ms)
            VALUES (?, ?, ?, ?, ?)
        """
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw HvscError.operationFailed("Failed to prepare upsert: \(String(cString: sqlite3_errmsg(db)))")
        }

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var count = 0
        sqlite3_exec(db, "BEGIN", nil, nil, nil)
        for row in rows {
            let virtualPath = row["virtualPath"] as? String ?? ""
            let fileName = row["fileName"] as? String ?? ""
            let songs = row["songs"] as? Int
            let startSong = row["startSong"] as? Int

            sqlite3_reset(stmt)
            sqlite3_bind_text(stmt, 1, (virtualPath as NSString).utf8String, -1, nil)
            sqlite3_bind_text(stmt, 2, (fileName as NSString).utf8String, -1, nil)
            if let s = songs { sqlite3_bind_int(stmt, 3, Int32(s)) } else { sqlite3_bind_null(stmt, 3) }
            if let ss = startSong { sqlite3_bind_int(stmt, 4, Int32(ss)) } else { sqlite3_bind_null(stmt, 4) }
            sqlite3_bind_int64(stmt, 5, now)
            if sqlite3_step(stmt) == SQLITE_DONE { count += 1 }
        }
        sqlite3_exec(db, "COMMIT", nil, nil, nil)
        rows.removeAll()
        return count
    }

    private func applyDeletions(_ paths: [String], libraryRoot: URL, db: OpaquePointer) throws -> Int {
        var deleted = 0
        for path in paths {
            let fileUrl = libraryRoot.appendingPathComponent(path)
            if FileManager.default.fileExists(atPath: fileUrl.path) {
                try? FileManager.default.removeItem(at: fileUrl)
            }
            let sql = "DELETE FROM hvsc_song_index WHERE virtual_path = ?"
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (path as NSString).utf8String, -1, nil)
                if sqlite3_step(stmt) == SQLITE_DONE { deleted += 1 }
            }
            sqlite3_finalize(stmt)
        }
        return deleted
    }

    // MARK: - SQLite helpers

    private func openDatabase() throws -> OpaquePointer {
        guard let libDir = FileManager.default.urls(for: .libraryDirectory,
                                                     in: .userDomainMask).first else {
            throw HvscError.operationFailed("Cannot resolve Library directory")
        }
        let dbUrl = libDir.appendingPathComponent("hvsc_metadata.db")
        var db: OpaquePointer?
        guard sqlite3_open(dbUrl.path, &db) == SQLITE_OK, let db else {
            throw HvscError.operationFailed("Cannot open SQLite database at \(dbUrl.path)")
        }
        try createSchemaIfNeeded(db)
        return db
    }

    private func createSchemaIfNeeded(_ db: OpaquePointer) throws {
        let createTable = """
            CREATE TABLE IF NOT EXISTS hvsc_song_index (
                virtual_path TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                songs INTEGER,
                start_song INTEGER,
                updated_at_ms INTEGER NOT NULL
            )
        """
        guard sqlite3_exec(db, createTable, nil, nil, nil) == SQLITE_OK else {
            throw HvscError.operationFailed("Failed to create schema: \(String(cString: sqlite3_errmsg(db)))")
        }
        sqlite3_exec(db,
            "CREATE INDEX IF NOT EXISTS idx_hvsc_song_file_name ON hvsc_song_index(file_name)",
            nil, nil, nil)
    }

    private func getSongIndexCount(_ db: OpaquePointer) -> Int {
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM hvsc_song_index", -1, &stmt, nil) == SQLITE_OK,
              sqlite3_step(stmt) == SQLITE_ROW else { return 0 }
        return Int(sqlite3_column_int(stmt, 0))
    }

    // MARK: - Archive path normalization

    private static func normalizeEntryPath(_ raw: String) -> String {
        // Strip leading component (archive root folder) if present, normalize separators.
        var parts = raw.replacingOccurrences(of: "\\", with: "/")
            .split(separator: "/").map(String.init).filter { !$0.isEmpty && $0 != "." }
        guard !parts.isEmpty else { return "" }
        // Drop top-level archive folder prefix (e.g. "HVSC/")
        if parts.count > 1 { parts.removeFirst() }
        return parts.joined(separator: "/")
    }

    private static func normalizeUpdateEntryPath(_ raw: String) -> String {
        return normalizeEntryPath(raw)
    }

    private static func isDeletionList(_ path: String) -> Bool {
        let lower = path.lowercased()
        return lower.hasSuffix("_deletions.txt") || lower.hasSuffix("deleted.txt")
    }

    private static func parseDeletionList(_ text: String) -> [String] {
        return text.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }
    }

    // MARK: - SID header parsing

    private struct SidHeader {
        let songs: Int
        let startSong: Int
    }

    private static func parseSidHeader(_ data: Data) -> SidHeader? {
        // SID file format: magic at offset 0x00 (PSID or RSID), songs at 0x0E (2 bytes BE),
        // start song at 0x10 (2 bytes BE). Minimum header size is 0x7C bytes.
        guard data.count >= 0x12 else { return nil }
        let magic = data.prefix(4)
        guard magic == Data([0x50, 0x53, 0x49, 0x44]) || magic == Data([0x52, 0x53, 0x49, 0x44]) else {
            return nil
        }
        let songs = Int(data[0x0E]) << 8 | Int(data[0x0F])
        let startSong = Int(data[0x10]) << 8 | Int(data[0x11])
        guard songs > 0 else { return nil }
        return SidHeader(songs: songs, startSong: max(1, startSong))
    }
}

// MARK: - HvscError

private enum HvscError: LocalizedError {
    case invalidArgument(String)
    case operationFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidArgument(let msg): return msg
        case .operationFailed(let msg): return msg
        }
    }
}
