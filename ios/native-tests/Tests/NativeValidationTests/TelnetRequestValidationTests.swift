import XCTest
@testable import NativeValidation

final class TelnetRequestValidationTests: XCTestCase {
    /*
     * HARD27-013. The Ultimate drops a Telnet session on idle reaping, on a reboot, and when
     * another client takes the last of its four slots. Android has closed the socket and thrown
     * "Connection closed" on EOF since HARD20-006; iOS returned an empty buffer, so `readScreen`
     * counted three empty reads and returned an empty screen while the session still believed it
     * was connected.
     */
    func testIosTelnetReportsEofAsAClosureRatherThanAnEmptyRead() throws {
        let source = try appSource("TelnetSocketPlugin.swift")

        // Both EOF signals: a read of 0 bytes, and a stream that has reached its end.
        XCTAssertTrue(source.contains("if readCount == 0 {\n                    /*"))
        XCTAssertTrue(source.contains("if inputStream.streamStatus == .atEnd {\n                try throwConnectionClosed()"))

        // The streams have to be closed, or isConnected keeps reporting a live session.
        XCTAssertTrue(source.contains("private func throwConnectionClosed() throws -> Never {"))
        XCTAssertTrue(source.contains("closeStreams()\n        throw NativePluginError.operationFailed(Self.connectionClosedMessage)"))

        // An expired deadline with nothing to read is an ordinary empty poll, not a closure.
        XCTAssertTrue(source.contains("if !collected.isEmpty {\n                break"))
    }

    func testIosClosureMessageIsTheOneTheTypeScriptClientMatches() throws {
        let source = try appSource("TelnetSocketPlugin.swift")
        XCTAssertTrue(source.contains(#"static let connectionClosedMessage = "Connection closed""#))

        /*
         * telnetClient.ts raises CONNECTION_CLOSED only for /connection closed/i, and
         * telnetSession.ts uses that code to invalidate authentication and reconnect. Any other
         * wording degrades to DISCONNECTED, which does not reconnect, so the exact string is the
         * contract rather than a detail.
         */
        let clientSource = try repoFile("src/lib/telnet/telnetClient.ts")
        XCTAssertTrue(clientSource.contains("/connection closed/i"))
        XCTAssertTrue(clientSource.contains(#""CONNECTION_CLOSED""#))
        XCTAssertTrue("Read failed: Connection closed".lowercased().contains("connection closed"))
    }

    func testAndroidAndIosAgreeOnTheClosureMessage() throws {
        let androidSource = try repoFile("android/app/src/main/java/uk/gleissner/c64commander/TelnetSocketPlugin.kt")
        XCTAssertTrue(androidSource.contains(#"IllegalStateException("Connection closed")"#))
    }

    private func appSource(_ name: String) throws -> String {
        try repoFile("ios/App/App/\(name)")
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
