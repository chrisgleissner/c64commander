import Foundation
import XCTest
@testable import NativeValidation

final class FtpReadCancellationTests: XCTestCase {
    func testCancellingARegisteredReadSetsItsToken() {
        let registry = FtpReadCancellationRegistry()
        let token = registry.register(requestId: "ftp-read-1")

        XCTAssertFalse(token.isCancelled)
        XCTAssertTrue(registry.cancel(requestId: "ftp-read-1"))
        XCTAssertTrue(token.isCancelled)
    }

    func testCancellingAFinishedReadReportsNothingToCancelRatherThanFailing() {
        // The TypeScript client fires cancelRead on abort without knowing whether the read has
        // already resolved, so this is the ordinary case rather than an error.
        let registry = FtpReadCancellationRegistry()
        let token = registry.register(requestId: "ftp-read-2")
        registry.release(requestId: "ftp-read-2")

        XCTAssertFalse(registry.cancel(requestId: "ftp-read-2"))
        XCTAssertFalse(token.isCancelled)
    }

    func testCancellingOneReadLeavesAConcurrentReadAlone() {
        let registry = FtpReadCancellationRegistry()
        let first = registry.register(requestId: "ftp-read-3")
        let second = registry.register(requestId: "ftp-read-4")

        registry.cancel(requestId: "ftp-read-3")

        XCTAssertTrue(first.isCancelled)
        XCTAssertFalse(second.isCancelled)
    }

    func testCancellingAnUnknownRequestIdIsHarmless() {
        let registry = FtpReadCancellationRegistry()
        XCTAssertFalse(registry.cancel(requestId: "never-registered"))
    }

    func testTokenSurvivesConcurrentCancellation() {
        let registry = FtpReadCancellationRegistry()
        let token = registry.register(requestId: "ftp-read-5")
        let group = DispatchGroup()

        for _ in 0..<64 {
            DispatchQueue.global().async(group: group) {
                registry.cancel(requestId: "ftp-read-5")
                _ = token.isCancelled
            }
        }

        XCTAssertEqual(group.wait(timeout: .now() + 5), .success)
        XCTAssertTrue(token.isCancelled)
    }

    func testAppSourceDeclaresCancelReadAndConsultsTheTokenInTheReadLoop() throws {
        let appSource = try String(contentsOf: appFileUrl("IOSFtp.swift"), encoding: .utf8)

        // The plugin surface: Capacitor rejects an undeclared method regardless of the @objc func.
        XCTAssertTrue(appSource.contains(#"CAPPluginMethod(name: "cancelRead", returnType: CAPPluginReturnPromise)"#))
        XCTAssertTrue(appSource.contains("@objc public func cancelRead(_ call: CAPPluginCall)"))

        // The read loop has to notice the flag, or cancelling changes nothing.
        XCTAssertTrue(appSource.contains("if cancellationToken?.isCancelled == true {"))
        XCTAssertTrue(appSource.contains(#"throw NativePluginError.operationFailed("FTP read cancelled")"#))

        // The bytes arrive on the data channel, so the token has to reach that session.
        XCTAssertTrue(appSource.contains("dataSession.cancellationToken = cancellationToken"))

        // Dispatching the cancel onto the plugin's serial queue would put it behind the read it is
        // meant to stop, so the body is read up to the next declaration and checked for that.
        let signature = try XCTUnwrap(appSource.range(of: "@objc public func cancelRead(_ call: CAPPluginCall)"))
        let afterSignature = appSource[signature.upperBound...]
        let nextDeclaration = afterSignature.range(of: "@objc public func")
        let body = nextDeclaration.map { String(afterSignature[..<$0.lowerBound]) } ?? String(afterSignature)
        XCTAssertFalse(body.contains("queue.async"))
        XCTAssertTrue(body.contains("FtpReadCancellationRegistry.shared.cancel(requestId: requestId)"))
    }

    func testAppSourceDeclaresGetNetworkStatus() throws {
        let appSource = try String(contentsOf: appFileUrl("AppDelegate.swift"), encoding: .utf8)

        XCTAssertTrue(appSource.contains(#"CAPPluginMethod(name: "getNetworkStatus", returnType: CAPPluginReturnPromise)"#))
        XCTAssertTrue(appSource.contains("@objc public func getNetworkStatus(_ call: CAPPluginCall)"))
        XCTAssertTrue(appSource.contains("NWPathMonitor()"))
    }

    private func appFileUrl(_ name: String) -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("App/App/\(name)")
    }
}
