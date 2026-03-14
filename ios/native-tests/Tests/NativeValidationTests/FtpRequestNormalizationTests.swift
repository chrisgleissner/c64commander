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
}
