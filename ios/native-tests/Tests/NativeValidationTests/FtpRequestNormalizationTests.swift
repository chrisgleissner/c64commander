import XCTest
@testable import NativeValidation

final class FtpRequestNormalizationTests: XCTestCase {
    func testResolveTimeoutMsUsesDefaultWhenValueMissing() {
        XCTAssertEqual(FtpRequestNormalization.resolveTimeoutMs(nil), 8_000)
    }

    func testResolveTimeoutMsClampsLowValues() {
        XCTAssertEqual(FtpRequestNormalization.resolveTimeoutMs(500), 1_000)
    }

    func testResolveTimeoutMsClampsHighValues() {
        XCTAssertEqual(FtpRequestNormalization.resolveTimeoutMs(99_000), 60_000)
    }

    func testResolveConnectTimeoutMsUsesNativeFtpDefault() {
        XCTAssertEqual(FtpRequestNormalization.resolveTimeoutMs(nil, defaultMs: 1_500), 1_500)
    }

    func testResolveTraceDetailsKeepsSupportedKeysOnly() {
        let details = FtpRequestNormalization.resolveTraceDetails([
            "correlationId": "corr-1",
            "trackInstanceId": 42,
            "playlistItemId": "item-7",
            "sourceKind": "hvsc",
            "localAccessMode": "web",
            "lifecycleState": "playing",
            "ignored": "nope",
        ])

        XCTAssertEqual(details["correlationId"] as? String, "corr-1")
        XCTAssertEqual(details["trackInstanceId"] as? Int, 42)
        XCTAssertEqual(details["playlistItemId"] as? String, "item-7")
        XCTAssertEqual(details["sourceKind"] as? String, "hvsc")
        XCTAssertEqual(details["localAccessMode"] as? String, "web")
        XCTAssertEqual(details["lifecycleState"] as? String, "playing")
        XCTAssertNil(details["ignored"])
    }

    func testIOSFtpClientExportsEveryNativeFtpMethod() throws {
        let source = try iosFtpSource()

        XCTAssertEqual(
            FtpPluginContract.exportedMethodNames(source: source),
            FtpPluginContract.expectedExportedMethods
        )
    }

    func testIOSFtpClientHasObjcHandlerForEveryExportedMethod() throws {
        let source = try iosFtpSource()
        let handlers = FtpPluginContract.objcHandlerNames(source: source)

        for method in FtpPluginContract.expectedExportedMethods {
            XCTAssertTrue(handlers.contains(method), "Missing @objc handler for \(method)")
        }
    }

    private func iosFtpSource() throws -> String {
        let testsFileUrl = URL(fileURLWithPath: #filePath)
        let packageRoot = testsFileUrl
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sourceUrl = packageRoot
            .deletingLastPathComponent()
            .appendingPathComponent("App/App/IOSFtp.swift")

        return try String(contentsOf: sourceUrl, encoding: .utf8)
    }
}
