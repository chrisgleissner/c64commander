import Foundation
import XCTest
@testable import NativeValidation

final class NativePluginsRegistrationTests: XCTestCase {
    func testAppDelegateRegistersExpectedNativePluginsInOrder() throws {
        let testsFileUrl = URL(fileURLWithPath: #filePath)
        let packageRoot = testsFileUrl
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let appDelegateUrl = packageRoot
            .deletingLastPathComponent()
            .appendingPathComponent("App/App/AppDelegate.swift")

        let appDelegateSource = try String(contentsOf: appDelegateUrl, encoding: .utf8)
        let registeredPlugins = NativePluginRegistration.registeredPluginClassNames(appDelegateSource: appDelegateSource)

        XCTAssertEqual(registeredPlugins, NativePluginRegistration.expectedPluginClassNames)
        XCTAssertEqual(Set(registeredPlugins).count, registeredPlugins.count)
    }
}
