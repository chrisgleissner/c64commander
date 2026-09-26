import XCTest
@testable import NativeValidation

final class HostValidationTests: XCTestCase {
    func testSanitizeHostAcceptsSimpleHostnamesAndIps() {
        XCTAssertEqual(HostValidation.sanitizeHost("c64u"), "c64u")
        XCTAssertEqual(HostValidation.sanitizeHost("192.0.2.20"), "192.0.2.20")
        XCTAssertEqual(HostValidation.sanitizeHost(" host.local "), "host.local")
    }

    func testSanitizeHostRejectsUrlsAndInvalidTokens() {
        XCTAssertNil(HostValidation.sanitizeHost("https://example.com"))
        XCTAssertNil(HostValidation.sanitizeHost("bad/path"))
        XCTAssertNil(HostValidation.sanitizeHost(""))
    }
}
