/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import XCTest
@testable import NativeValidation

final class FtpPathResolutionTests: XCTestCase {

    // MARK: - resolvePath

    func testAbsolutePathIsUsedAsIs() {
        XCTAssertEqual(FtpPathResolution.resolvePath("/Music/DEMOS", cwd: "/other"), "/Music/DEMOS")
    }

    func testRelativePathIsAppendedToCwd() {
        XCTAssertEqual(FtpPathResolution.resolvePath("DEMOS", cwd: "/Music"), "/Music/DEMOS")
    }

    func testRelativePathWithTrailingSlashCwd() {
        XCTAssertEqual(FtpPathResolution.resolvePath("DEMOS", cwd: "/Music/"), "/Music/DEMOS")
    }

    func testRootCwdRelativePath() {
        XCTAssertEqual(FtpPathResolution.resolvePath("file.sid", cwd: "/"), "/file.sid")
    }

    func testDotComponentIsStripped() {
        XCTAssertEqual(FtpPathResolution.resolvePath("/Music/./DEMOS", cwd: "/"), "/Music/DEMOS")
    }

    func testDoubleDotPopsSegment() {
        XCTAssertEqual(FtpPathResolution.resolvePath("/Music/DEMOS/..", cwd: "/"), "/Music")
    }

    func testDoubleDotAtRootStaysAtRoot() {
        XCTAssertEqual(FtpPathResolution.resolvePath("/..", cwd: "/"), "/")
    }

    func testMultipleDoubleDots() {
        XCTAssertEqual(FtpPathResolution.resolvePath("/a/b/c/../../d", cwd: "/"), "/a/d")
    }

    func testEmptyRawPathWithSlashCwd() {
        XCTAssertEqual(FtpPathResolution.resolvePath("", cwd: "/"), "/")
    }

    func testNestedRelativePath() {
        XCTAssertEqual(FtpPathResolution.resolvePath("sub/file.sid", cwd: "/Music"), "/Music/sub/file.sid")
    }

    // MARK: - parentPath

    func testRootParentIsRoot() {
        XCTAssertEqual(FtpPathResolution.parentPath("/"), "/")
    }

    func testTopLevelDirectoryParentIsRoot() {
        XCTAssertEqual(FtpPathResolution.parentPath("/Music"), "/")
    }

    func testNestedDirectoryParentStripsLastSegment() {
        XCTAssertEqual(FtpPathResolution.parentPath("/Music/DEMOS"), "/Music")
    }

    func testTrailingSlashIsStrippedBeforeParentLookup() {
        XCTAssertEqual(FtpPathResolution.parentPath("/Music/DEMOS/"), "/Music")
    }

    func testDeepPathParent() {
        XCTAssertEqual(FtpPathResolution.parentPath("/a/b/c/d"), "/a/b/c")
    }

    func testSingleSlashAfterRootReturnsRoot() {
        XCTAssertEqual(FtpPathResolution.parentPath("/singleSegment"), "/")
    }
}
