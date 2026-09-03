import Foundation
import XCTest
@testable import NativeValidation

private struct Tree {
    let folders: [String: [FtpWalkEntry]]
    var failFor: [String: Error] = [:]
    private(set) var listedPaths: [String] = []

    mutating func list(_ path: String) throws -> [FtpWalkEntry] {
        listedPaths.append(path)
        if let error = failFor[path] { throw error }
        return folders[path] ?? []
    }
}

private func file(_ name: String, in parent: String) -> FtpWalkEntry {
    FtpWalkEntry(name: name, path: parent == "/" ? "/\(name)" : "\(parent)/\(name)", type: "file")
}

private func directory(_ name: String, in parent: String) -> FtpWalkEntry {
    FtpWalkEntry(name: name, path: parent == "/" ? "/\(name)" : "\(parent)/\(name)", type: "directory")
}

final class FtpRecursiveWalkTests: XCTestCase {
    func testCollectsFilesFromEveryDepthAndNeverListsDirectoriesAsEntries() {
        var tree = Tree(folders: [
            "/": [file("root.sid", in: "/"), directory("music", in: "/")],
            "/music": [file("song.sid", in: "/music"), directory("demos", in: "/music")],
            "/music/demos": [file("demo.sid", in: "/music/demos")],
        ])

        let result = walkFtpDirectory(root: "/", maxDepth: 8, maxEntries: 5_000) { try tree.list($0) }

        XCTAssertEqual(result.entries.map(\.path), ["/root.sid", "/music/song.sid", "/music/demos/demo.sid"])
        XCTAssertEqual(result.failures, [])
        XCTAssertFalse(result.timedOut)
    }

    func testSkipsOneUnreadableFolderAndCarriesOn() {
        var tree = Tree(folders: [
            "/": [directory("bad", in: "/"), directory("good", in: "/")],
            "/good": [file("ok.sid", in: "/good")],
        ])
        tree.failFor["/bad"] = NSError(domain: "ftp", code: 550, userInfo: [NSLocalizedDescriptionKey: "550 Permission denied"])

        let result = walkFtpDirectory(root: "/", maxDepth: 8, maxEntries: 5_000) { try tree.list($0) }

        XCTAssertEqual(result.entries.map(\.path), ["/good/ok.sid"])
        XCTAssertEqual(result.failures, [FtpWalkFailure(path: "/bad", message: "550 Permission denied")])
        XCTAssertFalse(result.timedOut)
    }

    func testStopsTheWholeWalkOnADataChannelTimeout() {
        /*
         * A data-channel timeout means the firmware's single-threaded FTP is already wedging on
         * PASV cycles. Continuing would pile more data channels onto it, so the walk stops and the
         * caller is told the listing is incomplete (HARD9-078).
         */
        var tree = Tree(folders: [
            "/": [directory("a", in: "/"), directory("b", in: "/")],
            "/b": [file("never-reached.sid", in: "/b")],
        ])
        tree.failFor["/a"] = FtpWalkListingTimeout(message: "FTP response timed out")

        let result = walkFtpDirectory(root: "/", maxDepth: 8, maxEntries: 5_000) { try tree.list($0) }

        XCTAssertTrue(result.timedOut)
        XCTAssertEqual(result.failures, [FtpWalkFailure(path: "/a", message: "FTP response timed out")])
        XCTAssertEqual(result.entries, [])
        XCTAssertFalse(tree.listedPaths.contains("/b"), "the walk must not keep opening data channels")
    }

    func testReportsAFolderBeyondMaxDepthWithoutDescendingIntoIt() {
        var tree = Tree(folders: [
            "/": [directory("deep", in: "/")],
            "/deep": [file("hidden.sid", in: "/deep")],
        ])

        let result = walkFtpDirectory(root: "/", maxDepth: 0, maxEntries: 5_000) { try tree.list($0) }

        XCTAssertEqual(result.entries, [])
        XCTAssertEqual(
            result.failures,
            [FtpWalkFailure(path: "/deep", message: FtpRecursiveWalkLimits.maxDepthMessage(maxDepth: 0))]
        )
        XCTAssertFalse(tree.listedPaths.contains("/deep"))
    }

    func testStopsAtTheEntryCapAndSaysSo() {
        var tree = Tree(folders: [
            "/": [file("a.sid", in: "/"), file("b.sid", in: "/"), file("c.sid", in: "/")],
        ])

        let result = walkFtpDirectory(root: "/", maxDepth: 8, maxEntries: 2) { try tree.list($0) }

        XCTAssertEqual(result.entries.map(\.name), ["a.sid", "b.sid"])
        XCTAssertEqual(
            result.failures,
            [FtpWalkFailure(path: "/", message: FtpRecursiveWalkLimits.cappedMessage(maxEntries: 2))]
        )
    }

    func testVisitsEachFolderOnceEvenWhenTheListingLoopsBackOnItself() {
        // A symlinked or self-referencing directory would otherwise walk forever.
        var tree = Tree(folders: [
            "/": [directory("loop", in: "/")],
            "/loop": [directory("loop", in: "/"), file("once.sid", in: "/loop")],
        ])

        let result = walkFtpDirectory(root: "/", maxDepth: 8, maxEntries: 5_000) { try tree.list($0) }

        XCTAssertEqual(result.entries.map(\.path), ["/loop/once.sid"])
        XCTAssertEqual(tree.listedPaths.filter { $0 == "/loop" }.count, 1)
    }

    func testLimitsMatchTheTypeScriptDefaultsAndAreClampedTheWayAndroidClampsThem() {
        XCTAssertEqual(FtpRecursiveWalkLimits.clampDepth(nil), 8)
        XCTAssertEqual(FtpRecursiveWalkLimits.clampEntries(nil), 5_000)
        XCTAssertEqual(FtpRecursiveWalkLimits.clampDepth(-1), 0)
        XCTAssertEqual(FtpRecursiveWalkLimits.clampDepth(99), 32)
        XCTAssertEqual(FtpRecursiveWalkLimits.clampEntries(0), 1)
        XCTAssertEqual(FtpRecursiveWalkLimits.clampEntries(999_999), 50_000)
    }

    func testAppAndAndroidUseTheSameFailureMessages() throws {
        // The TypeScript side shows these strings to the user, so the two natives must agree.
        let androidSource = try repoFile("android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt")
        XCTAssertTrue(androidSource.contains("FTP recursive listing stopped after $maxEntries entries"))
        XCTAssertTrue(androidSource.contains("FTP recursive listing max depth $maxDepth reached"))

        let iosSource = try repoFile("ios/App/App/IOSFtp.swift")
        XCTAssertTrue(iosSource.contains(#""FTP recursive listing stopped after \(maxEntries) entries""#))
        XCTAssertTrue(iosSource.contains(#""FTP recursive listing max depth \(maxDepth) reached""#))
    }

    func testAppImplementsTheWalkAndResolvesTheContractTheTypeScriptSideReads() throws {
        let iosSource = try repoFile("ios/App/App/IOSFtp.swift")

        XCTAssertTrue(iosSource.contains(#"CAPPluginMethod(name: "listDirectoryRecursive", returnType: CAPPluginReturnPromise)"#))
        XCTAssertTrue(iosSource.contains("@objc public func listDirectoryRecursive(_ call: CAPPluginCall)"))
        XCTAssertTrue(iosSource.contains("func walkFtpDirectory("))

        // camelCase, and all three fields: the TypeScript side reads timedOut, and a snake_case
        // spelling silently dropped the "walk aborted early" signal on Android once (HARD9-078).
        XCTAssertTrue(iosSource.contains(#""partialFailures": result.failures.map"#))
        XCTAssertTrue(iosSource.contains(#""timedOut": result.timedOut"#))

        // One connection for the whole walk: reconnecting per folder is the PASV-cycle wedge.
        let signature = try XCTUnwrap(iosSource.range(of: "@objc public func listDirectoryRecursive(_ call: CAPPluginCall)"))
        let afterSignature = iosSource[signature.upperBound...]
        let nextDeclaration = afterSignature.range(of: "@objc public func")
        let body = nextDeclaration.map { String(afterSignature[..<$0.lowerBound]) } ?? String(afterSignature)
        XCTAssertEqual(body.components(separatedBy: "try session.connect()").count - 1, 1)
    }

    private func repoFile(_ relativePath: String) throws -> String {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return try String(contentsOf: repoRoot.appendingPathComponent(relativePath), encoding: .utf8)
    }
}
