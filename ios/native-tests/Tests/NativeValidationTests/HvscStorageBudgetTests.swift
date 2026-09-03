import Foundation
import XCTest
@testable import NativeValidation

/*
 * HARD27-028. The JavaScript install flow refuses an HVSC install that cannot fit before it
 * downloads the archive, and it sizes that refusal from `HvscIngestion.getStorageBudget`. Android
 * implements that method; iOS did not, so the call rejected as unimplemented,
 * `ensureRoomForHvscInstall` logged "HVSC storage budget unavailable" and skipped, and every iOS
 * install ran with no free-space check at all. A full volume then failed part-way through the
 * extraction instead of before the download.
 */
final class HvscStorageBudgetTests: XCTestCase {
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

    // MARK: - availableBytes

    func testTheImportantUsageFigureWinsWhenBothAreAvailable() {
        // iOS reports a larger figure for important usage because it counts purgeable caches.
        XCTAssertEqual(
            HvscStorageBudget.availableBytes(importantUsageCapacity: 9_000, volumeAvailableCapacity: 4_000),
            9_000
        )
    }

    func testThePlainCapacityIsUsedWhenImportantUsageIsUnavailable() {
        XCTAssertEqual(
            HvscStorageBudget.availableBytes(importantUsageCapacity: nil, volumeAvailableCapacity: 4_000),
            4_000
        )
    }

    func testANonPositiveImportantUsageFallsBackRatherThanReportingIt() {
        // A volume that reports 0 for important usage but has room must not refuse the install.
        XCTAssertEqual(
            HvscStorageBudget.availableBytes(importantUsageCapacity: 0, volumeAvailableCapacity: 4_000),
            4_000
        )
        XCTAssertEqual(
            HvscStorageBudget.availableBytes(importantUsageCapacity: -1, volumeAvailableCapacity: 4_000),
            4_000
        )
    }

    func testNoFigureAtAllResolvesToZeroSoTheCheckIsSkippedRatherThanFailed() {
        // `ensureRoomForHvscInstall` returns without refusing on a non-positive figure.
        XCTAssertEqual(
            HvscStorageBudget.availableBytes(importantUsageCapacity: nil, volumeAvailableCapacity: nil),
            0
        )
        XCTAssertEqual(
            HvscStorageBudget.availableBytes(importantUsageCapacity: nil, volumeAvailableCapacity: 0),
            0
        )
    }

    func testTheImportantUsageFigureIsNarrowedToIntTheWayThePluginResolvesIt() {
        // The plugin resolves an `Int`, which is what Capacitor coerces to a JS number without a
        // bridging cast; `volumeAvailableCapacityForImportantUsage` is an `Int64`.
        let wide: Int64 = 64_424_509_440
        XCTAssertEqual(
            HvscStorageBudget.availableBytes(importantUsageCapacity: wide, volumeAvailableCapacity: nil),
            64_424_509_440
        )
    }

    // MARK: - libraryPresent

    func testAnUnreadableLibraryDirectoryCountsAsAbsent() {
        // `contentsOfDirectory` returns nil when the directory does not exist.
        XCTAssertFalse(HvscStorageBudget.libraryPresent(entries: nil))
    }

    func testAnEmptyLibraryDirectoryCountsAsAbsent() {
        // The plugin creates `hvsc/library` before extracting, so an empty one is not a library.
        XCTAssertFalse(HvscStorageBudget.libraryPresent(entries: []))
    }

    func testALibraryWithFilesInItDoublesThePeakTheInstallNeeds() {
        XCTAssertTrue(HvscStorageBudget.libraryPresent(entries: ["MUSICIANS"]))
    }

    // MARK: - The app file the mirror stands in for

    func testThePluginRegistersGetStorageBudgetSoTheBridgeCanCallIt() throws {
        let source = try pluginSource()

        // A method missing from `pluginMethods` rejects with "not implemented on ios" however
        // complete its body is.
        XCTAssertTrue(source.contains("CAPPluginMethod(name: \"getStorageBudget\", returnType: CAPPluginReturnPromise)"))
        XCTAssertTrue(source.contains("@objc public func getStorageBudget(_ call: CAPPluginCall)"))
    }

    func testThePluginReadsBothCapacityKeysAndPrefersImportantUsage() throws {
        let source = try pluginSource()

        XCTAssertTrue(source.contains(".volumeAvailableCapacityForImportantUsageKey"))
        XCTAssertTrue(source.contains("availableBytes = Int(important)"))
        XCTAssertTrue(source.contains(".volumeAvailableCapacityKey"))
        let importantRange = try XCTUnwrap(source.range(of: "values.volumeAvailableCapacityForImportantUsage"))
        let plainRange = try XCTUnwrap(source.range(of: "} else if let available = values.volumeAvailableCapacity"))
        XCTAssertLessThan(importantRange.lowerBound, plainRange.lowerBound)
    }

    func testThePluginResolvesRatherThanRejectsWhenTheVolumeReportsNothing() throws {
        let source = try pluginSource()

        // A reject would surface as an error toast on a device that is merely unusual, and the
        // TypeScript caller already treats 0 as "no budget known".
        let budgetRange = try XCTUnwrap(source.range(of: "@objc public func getStorageBudget"))
        let helpersRange = try XCTUnwrap(source.range(of: "// MARK: - Private helpers"))
        let body = String(source[budgetRange.lowerBound..<helpersRange.lowerBound])
        XCTAssertFalse(body.contains("call.reject"))
        XCTAssertTrue(body.contains("call.resolve([\"availableBytes\": 0, \"libraryPresent\": false])"))
    }

    func testThePluginTestsTheLibraryForEmptinessRatherThanExistence() throws {
        let source = try pluginSource()

        XCTAssertTrue(source.contains("let entries = try? FileManager.default.contentsOfDirectory(atPath: libraryRoot.path)"))
        XCTAssertTrue(source.contains("let libraryPresent = !(entries ?? []).isEmpty"))
        // `resolveLibraryRoot()` would create the directory, which would report every device as
        // holding a library and double the space the check demands.
        let budgetRange = try XCTUnwrap(source.range(of: "@objc public func getStorageBudget"))
        let helpersRange = try XCTUnwrap(source.range(of: "// MARK: - Private helpers"))
        let body = String(source[budgetRange.lowerBound..<helpersRange.lowerBound])
        XCTAssertFalse(body.contains("self.resolveLibraryRoot()"))
    }
}
