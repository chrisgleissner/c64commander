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

    func testResolveTransferTimeoutMsTreatsZeroAsNoIdleTimeout() {
        // The songlengths read from the Ultimate sends timeoutMs: 0 because a truncating timeout
        // can wedge the firmware's FTP data channel. resolveTimeoutMs turned that into 1 s, so the
        // read came back truncated and the songlengths import reported failure (HARD27-012).
        XCTAssertEqual(FtpRequestNormalization.resolveTimeoutMs(0), 1_000)
        XCTAssertNil(FtpRequestNormalization.resolveTransferTimeoutMs(0))
    }

    func testResolveTransferTimeoutMsKeepsTheDefaultWhenAbsent() {
        XCTAssertEqual(FtpRequestNormalization.resolveTransferTimeoutMs(nil), 8_000)
    }

    func testResolveTransferTimeoutMsBoundsAPositiveValueTheWayAndroidDoes() {
        XCTAssertEqual(FtpRequestNormalization.resolveTransferTimeoutMs(500), 1_000)
        XCTAssertEqual(FtpRequestNormalization.resolveTransferTimeoutMs(30_000), 30_000)
        // 10 minutes, not the 60 s a whole-transfer deadline needed: this is an idle timeout, so a
        // large disk image over the c64u's slow FTP no longer fails just for taking a while.
        XCTAssertEqual(FtpRequestNormalization.resolveTransferTimeoutMs(99_000_000), 600_000)
    }

    func testReadSizeCapMatchesAndroidsMessage() {
        XCTAssertEqual(FtpRequestNormalization.maxReadFileBytes, 32 * 1024 * 1024)
        XCTAssertEqual(
            FtpRequestNormalization.maximumReadableSizeMessage(),
            "File exceeds the maximum readable size (32MB)"
        )
    }

    func testIOSFtpAppliesTheIdleTimeoutAndSizeCapInTheReadLoop() throws {
        let source = try iosFtpSource()

        // The read has to use the transfer timeout, not the clamped control-channel one.
        XCTAssertTrue(source.contains("static func resolveTransferTimeout(_ timeoutMs: Int?, defaultMs: Int = 8_000) -> TimeInterval?"))
        XCTAssertTrue(source.contains("session.transferTimeout = FtpRequestOptions.resolveTransferTimeout(call.getInt(\"timeoutMs\"))"))
        XCTAssertTrue(source.contains("dataSession.transferTimeout = transferTimeout"))

        // Reset by every chunk, which is what makes it an idle timeout rather than a deadline.
        XCTAssertTrue(source.contains("deadline = FtpSession.idleDeadline(from: Date(), timeout: transferTimeout)"))
        XCTAssertTrue(source.contains("static let maxReadFileBytes = 32 * 1024 * 1024"))
        XCTAssertTrue(source.contains("if bytes.count > FtpSession.maxReadFileBytes {"))
    }

    func testFolderPickerBoundsBothReadPaths() throws {
        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let source = try String(
            contentsOf: packageRoot.deletingLastPathComponent().appendingPathComponent("App/App/NativePlugins.swift"),
            encoding: .utf8
        )

        // Both readFile and readFileFromTree previously used Data(contentsOf:) with no bound.
        XCTAssertEqual(source.components(separatedBy: "try self.readBoundedFile(at:").count - 1, 2)
        XCTAssertTrue(source.contains("static let maxReadFileBytes = 32 * 1024 * 1024"))
        XCTAssertFalse(source.contains("let data = try Data(contentsOf: scoped)"))
        XCTAssertFalse(source.contains("let data = try Data(contentsOf: fileUrl)"))
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
