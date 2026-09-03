import Foundation
import XCTest
@testable import NativeValidation

/*
 * HARD27-018. A baseline install used to delete the library and its index before extracting
 * anything, and extraction is the long, memory-hungry part. A jetsam kill or a cancellation left
 * the user with no HVSC library at all - roughly sixty thousand songs and a half-hour install,
 * with nothing to fall back on.
 *
 * The ordering is the part of the finding the review calls certain, and it is what these cases
 * pin. The extraction itself still materialises the whole archive in memory; that half is
 * outstanding and `docs/architecture.md` now says so.
 */
final class HvscStagedPromotionTests: XCTestCase {
    private func pluginSource() throws -> String {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return try String(
            contentsOf: repoRoot.appendingPathComponent("ios/App/App/HvscIngestionPlugin.swift"),
            encoding: .utf8
        )
    }

    func testNothingDeletesTheLibraryBeforeExtractionAnyMore() throws {
        let source = try pluginSource()

        // clearLibrary ran before the extraction loop and is gone; nothing replaced it in place.
        XCTAssertFalse(source.contains("clearLibrary"))
        XCTAssertFalse(source.contains("try self.clearLibrary(libraryRoot: libraryRoot, db: db)"))
        XCTAssertTrue(source.contains("let extractionRoot = resetLibrary ? stagingRoot : libraryRoot"))
        XCTAssertTrue(source.contains("let targetUrl = extractionRoot.appendingPathComponent(normalizedPath)"))
    }

    func testStagingIsResetBeforeUseAndRemovedAfterwardsWhateverHappens() throws {
        let source = try pluginSource()

        XCTAssertTrue(source.contains("try self.resetDirectory(stagingRoot)"))
        // A defer, so a throw, a cancellation and success all clean up the same way.
        XCTAssertTrue(source.contains("defer {\n                    if resetLibrary {\n                        try? FileManager.default.removeItem(at: stagingRoot)"))
    }

    func testTheRowCountIsCheckedBeforeThePromotionRatherThanAfter() throws {
        let source = try pluginSource()
        let promoteRange = try XCTUnwrap(source.range(of: "metadataUpserts += try self.promoteStagedLibrary("))
        let checkRange = try XCTUnwrap(source.range(of: "if pendingUpserts.count < minExpectedRows {"))

        // Failing the check has to leave the old library promoted and intact, which is the point
        // of staging: the live index still describes it at that moment.
        XCTAssertLessThan(checkRange.lowerBound, promoteRange.lowerBound)
    }

    func testTheIndexIsNotWrittenUntilTheFilesAreInPlace() throws {
        let source = try pluginSource()

        // In reset mode the live index still describes the old library, which is still on disk.
        XCTAssertTrue(source.contains("if !resetLibrary && pendingUpserts.count >= dbBatchSize {"))
        XCTAssertTrue(source.contains("deferredUpserts: &pendingUpserts"))
    }

    func testPromotionSwapsTheFilesFirstAndTheIndexInOneTransaction() throws {
        let source = try pluginSource()
        let signature = try XCTUnwrap(source.range(of: "private func promoteStagedLibrary("))
        let after = source[signature.upperBound...]
        let end = after.range(of: "private func execute(")
        let body = end.map { String(after[..<$0.lowerBound]) } ?? String(after)

        let movedLibraryAway = try XCTUnwrap(body.range(of: "try fileManager.moveItem(at: libraryRoot, to: oldRoot)"))
        let movedStagingIn = try XCTUnwrap(body.range(of: "try fileManager.moveItem(at: stagingRoot, to: libraryRoot)"))
        let beganTransaction = try XCTUnwrap(body.range(of: #"try self.execute(sql: "BEGIN IMMEDIATE", db: db)"#))
        let removedOld = try XCTUnwrap(body.range(of: "if fileManager.fileExists(atPath: oldRoot.path) {\n            try? fileManager.removeItem(at: oldRoot)"))

        // Files in place before any row claims they are; the old copy kept until the index commits.
        XCTAssertLessThan(movedLibraryAway.lowerBound, movedStagingIn.lowerBound)
        XCTAssertLessThan(movedStagingIn.lowerBound, beganTransaction.lowerBound)
        XCTAssertLessThan(beganTransaction.lowerBound, removedOld.lowerBound)

        XCTAssertTrue(body.contains(#"try self.execute(sql: "DELETE FROM hvsc_song_index", db: db)"#))
        XCTAssertTrue(body.contains(#"try self.execute(sql: "COMMIT", db: db)"#))
        XCTAssertTrue(body.contains(#"try? self.execute(sql: "ROLLBACK", db: db)"#))
    }

    func testAFailedPromotionPutsTheUsersLibraryBack() throws {
        let source = try pluginSource()
        let signature = try XCTUnwrap(source.range(of: "private func promoteStagedLibrary("))
        let after = source[signature.upperBound...]
        let end = after.range(of: "private func execute(")
        let body = end.map { String(after[..<$0.lowerBound]) } ?? String(after)

        // Two recovery paths: the staging rename failing, and the index transaction failing.
        XCTAssertEqual(body.components(separatedBy: "try? fileManager.moveItem(at: oldRoot, to: libraryRoot)").count - 1, 2)
    }

    func testArchitectureTableNoLongerClaimsIosStreamsTheArchive() throws {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let architecture = try String(
            contentsOf: repoRoot.appendingPathComponent("docs/architecture.md"),
            encoding: .utf8
        )

        XCTAssertFalse(architecture.contains("| Native (streaming)   | Native (streaming) |"))
        XCTAssertTrue(architecture.contains("Native (in memory)"))
        XCTAssertFalse(architecture.contains("Staged (planned)"))
    }
}
