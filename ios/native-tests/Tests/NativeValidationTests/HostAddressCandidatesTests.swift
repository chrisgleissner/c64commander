import Foundation
import XCTest
@testable import NativeValidation

final class HostAddressCandidatesTests: XCTestCase {
    private struct Refused: Error, Equatable {
        let address: String
    }

    func testAnAddressThatTimesOutUsesOnlyItsShareSoTheNextAddressFitsInTheSameBudget() throws {
        var clock = Date(timeIntervalSince1970: 1_000)
        var attempts: [(String, TimeInterval)] = []

        let connected = try HostAddressCandidates.connectFirstReachable(
            ["198.51.100.20", "192.0.2.10"],
            totalTimeout: 1.5,
            now: { clock },
            attempt: { address, timeout -> String in
                attempts.append((address, timeout))
                if address == "198.51.100.20" {
                    clock = clock.addingTimeInterval(timeout)
                    throw Refused(address: address)
                }
                return "connected"
            },
            onAttemptFailed: { _, _, _ in }
        )

        XCTAssertEqual(connected.address, "192.0.2.10")
        XCTAssertEqual(connected.value, "connected")
        XCTAssertEqual(attempts.map(\.0), ["198.51.100.20", "192.0.2.10"])
        XCTAssertEqual(attempts[0].1, 0.75, accuracy: 0.000_1)
        XCTAssertEqual(attempts[1].1, 0.75, accuracy: 0.000_1)
    }

    func testAQuickRefusalLeavesTheRestOfTheBudgetToTheNextAddress() throws {
        let clock = Date(timeIntervalSince1970: 1_000)
        var failed: [String] = []
        var secondTimeout: TimeInterval = 0

        _ = try HostAddressCandidates.connectFirstReachable(
            ["198.51.100.20", "192.0.2.10"],
            totalTimeout: 5,
            now: { clock },
            attempt: { address, timeout in
                if address == "198.51.100.20" {
                    throw Refused(address: address)
                }
                secondTimeout = timeout
            },
            onAttemptFailed: { address, _, _ in failed.append(address) }
        )

        XCTAssertEqual(failed, ["198.51.100.20"])
        XCTAssertEqual(secondTimeout, 5, accuracy: 0.000_1)
    }

    func testEveryAddressFailingThrowsTheLastFailure() {
        XCTAssertThrowsError(
            try HostAddressCandidates.connectFirstReachable(
                ["198.51.100.20", "192.0.2.10"],
                totalTimeout: 1,
                attempt: { address, _ in throw Refused(address: address) },
                onAttemptFailed: { _, _, _ in }
            )
        ) { error in
            XCTAssertEqual(error as? Refused, Refused(address: "192.0.2.10"))
        }
    }

    func testAnExhaustedBudgetStopsBeforeTheRemainingAddresses() {
        var clock = Date(timeIntervalSince1970: 1_000)
        var attempted: [String] = []

        XCTAssertThrowsError(
            try HostAddressCandidates.connectFirstReachable(
                ["198.51.100.20", "192.0.2.10"],
                totalTimeout: 1,
                now: { clock },
                attempt: { address, _ in
                    attempted.append(address)
                    clock = clock.addingTimeInterval(1)
                    throw Refused(address: address)
                },
                onAttemptFailed: { _, _, _ in }
            )
        )
        XCTAssertEqual(attempted, ["198.51.100.20"])
    }

    func testResolvedAddressesAreOrderedIpv4FirstWithoutDuplicates() {
        XCTAssertEqual(
            HostAddressCandidates.orderIpv4First(["2001:db8::1", "198.51.100.20", "192.0.2.10", "198.51.100.20"]),
            ["198.51.100.20", "192.0.2.10", "2001:db8::1"]
        )
    }

    func testAppHoldsThisExactEnum() throws {
        let mirror = try enumBlock(in: repoFile("ios/native-tests/Sources/NativeValidation/HostAddressCandidates.swift"))
        let app = try enumBlock(in: repoFile("ios/App/App/IOSFtp.swift"))
        XCTAssertEqual(app, mirror)
    }

    func testFtpAndTelnetConnectThroughEveryResolvedAddress() throws {
        let ftp = try repoFile("ios/App/App/IOSFtp.swift")
        XCTAssertTrue(ftp.contains("let candidates = HostAddressCandidates.resolve(host)\n        let connected = try HostAddressCandidates.connectFirstReachable("))
        XCTAssertTrue(ftp.contains("CFStreamCreatePairWithSocketToHost(nil, address as CFString, UInt32(port), &readStream, &writeStream)"))

        let telnet = try repoFile("ios/App/App/TelnetSocketPlugin.swift")
        XCTAssertTrue(telnet.contains("let candidates = HostAddressCandidates.resolve(host)\n        let connected = try HostAddressCandidates.connectFirstReachable("))
        XCTAssertTrue(telnet.contains("CFStreamCreatePairWithSocketToHost(nil, address as CFString, UInt32(port), &readStream, &writeStream)"))
        XCTAssertFalse(telnet.contains("CFStreamCreatePairWithSocketToHost(nil, host as CFString"))
    }

    func testPassiveDataConnectionGoesToTheAddressTheControlConnectionReached() throws {
        let ftp = try repoFile("ios/App/App/IOSFtp.swift")
        XCTAssertTrue(ftp.contains("controlAddress = connected.address"))

        let start = try XCTUnwrap(ftp.range(of: "private func openPassiveDataChannel()"))
        let end = try XCTUnwrap(ftp.range(of: "\n    }\n", range: start.upperBound..<ftp.endIndex))
        let body = String(ftp[start.upperBound..<end.lowerBound])
        XCTAssertTrue(body.contains("let dataHost = controlAddress ?? host"))
        XCTAssertTrue(body.contains("return (dataHost, dataPort)"))
        XCTAssertFalse(body.contains(#"let dataHost = "\(numbers[0])"#))
    }

    private func enumBlock(in source: String) throws -> String {
        let start = try XCTUnwrap(source.range(of: "enum HostAddressCandidates {"))
        let end = try XCTUnwrap(source.range(of: "\n}\n", range: start.upperBound..<source.endIndex))
        return String(source[start.lowerBound..<end.upperBound])
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
