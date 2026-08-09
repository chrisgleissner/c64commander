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

    func testSceneDelegateRegistersPluginsAgainstItsStoryboardBridge() throws {
        let testsFileUrl = URL(fileURLWithPath: #filePath)
        let packageRoot = testsFileUrl
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sceneDelegateUrl = packageRoot
            .deletingLastPathComponent()
            .appendingPathComponent("App/App/SceneDelegate.swift")

        let sceneDelegateSource = try String(contentsOf: sceneDelegateUrl, encoding: .utf8)

        XCTAssertTrue(sceneDelegateSource.contains("window?.rootViewController as? CAPBridgeViewController"))
        XCTAssertTrue(sceneDelegateSource.contains("registerNativePluginsIfNeeded(for: bridgeViewController)"))
        XCTAssertFalse(sceneDelegateSource.contains("window = UIWindow(windowScene:"))
    }
}
