/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import XCTest
@testable import NativeValidation

final class PathSanitizationTests: XCTestCase {

    // MARK: - NativePluginError.errorDescription

    func testInvalidArgumentReturnsMessage() {
        let error = NativePluginError.invalidArgument("bad input")
        XCTAssertEqual(error.errorDescription, "bad input")
    }

    func testUnavailableReturnsMessage() {
        let error = NativePluginError.unavailable("not available")
        XCTAssertEqual(error.errorDescription, "not available")
    }

    func testOperationFailedReturnsMessage() {
        let error = NativePluginError.operationFailed("op failed")
        XCTAssertEqual(error.errorDescription, "op failed")
    }

    // MARK: - PathSanitization.sanitizeRelativePath

    func testEmptyInputReturnsEmpty() throws {
        XCTAssertEqual(try PathSanitization.sanitizeRelativePath(""), "")
    }

    func testWhitespaceOnlyInputReturnsEmpty() throws {
        XCTAssertEqual(try PathSanitization.sanitizeRelativePath("   \t\n"), "")
    }

    func testSimpleFileNamePassesThrough() throws {
        XCTAssertEqual(try PathSanitization.sanitizeRelativePath("file.sid"), "file.sid")
    }

    func testNestedPathIsJoined() throws {
        XCTAssertEqual(try PathSanitization.sanitizeRelativePath("Music/DEMOS/demo.sid"),
                       "Music/DEMOS/demo.sid")
    }

    func testLeadingAndTrailingSlashesAreStripped() throws {
        XCTAssertEqual(try PathSanitization.sanitizeRelativePath("/Music/DEMOS/"), "Music/DEMOS")
    }

    func testDoubleSlashesAreCollapsed() throws {
        XCTAssertEqual(try PathSanitization.sanitizeRelativePath("Music//DEMOS"), "Music/DEMOS")
    }

    func testParentTraversalThrows() {
        XCTAssertThrowsError(try PathSanitization.sanitizeRelativePath("../etc/passwd")) { error in
            guard let pluginError = error as? NativePluginError,
                  case .invalidArgument(let message) = pluginError else {
                XCTFail("Expected NativePluginError.invalidArgument, got \(error)")
                return
            }
            XCTAssertTrue(message.contains("parent traversal"))
        }
    }

    func testEmbeddedParentTraversalThrows() {
        XCTAssertThrowsError(try PathSanitization.sanitizeRelativePath("Music/../secret")) { error in
            guard let pluginError = error as? NativePluginError,
                  case .invalidArgument = pluginError else {
                XCTFail("Expected NativePluginError.invalidArgument, got \(error)")
                return
            }
        }
    }
}
