import XCTest
@testable import NativeValidation

final class TelnetRequestValidationTests: XCTestCase {
    func testResolvePortAcceptsValidPorts() {
        XCTAssertEqual(try? TelnetRequestValidation.resolvePort(23).get(), 23)
        XCTAssertEqual(try? TelnetRequestValidation.resolvePort(65_535).get(), 65_535)
    }

    func testResolvePortRejectsOutOfRangePorts() {
        XCTAssertThrowsError(try TelnetRequestValidation.resolvePort(0).get()) { error in
            XCTAssertEqual(error.localizedDescription, "port must be between 1 and 65535")
        }
        XCTAssertThrowsError(try TelnetRequestValidation.resolvePort(-1).get()) { error in
            XCTAssertEqual(error.localizedDescription, "port must be between 1 and 65535")
        }
        XCTAssertThrowsError(try TelnetRequestValidation.resolvePort(70_000).get()) { error in
            XCTAssertEqual(error.localizedDescription, "port must be between 1 and 65535")
        }
    }

    func testResolveTimeoutMsRejectsNonPositiveTimeouts() {
        XCTAssertEqual(try? TelnetRequestValidation.resolveTimeoutMs(5_000).get(), 5_000)
        XCTAssertThrowsError(try TelnetRequestValidation.resolveTimeoutMs(0).get()) { error in
            XCTAssertEqual(error.localizedDescription, "timeoutMs must be greater than 0")
        }
        XCTAssertThrowsError(try TelnetRequestValidation.resolveTimeoutMs(-500).get()) { error in
            XCTAssertEqual(error.localizedDescription, "timeoutMs must be greater than 0")
        }
    }
}