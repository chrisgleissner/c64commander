import UIKit
import Capacitor

private enum IOSStartupTrace {
    private static let lock = NSLock()
    private static var emittedEvents = Set<String>()

    static func emit(_ event: String, details: [String: Any] = [:], once: Bool = true) {
        lock.lock()
        if once, emittedEvents.contains(event) {
            lock.unlock()
            return
        }
        if once {
            emittedEvents.insert(event)
        }
        lock.unlock()

        let uptimeMs = Int(ProcessInfo.processInfo.systemUptime * 1000)
        var payload = details
        payload["origin"] = "startup"
        payload["event"] = event
        payload["uptimeMs"] = uptimeMs
        IOSDiagnostics.log(.info, "C64_STARTUP_EVENT|\(event)|\(uptimeMs)", details: payload)
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var nativePluginsRegistered = false
    private weak var nativePluginsBridge: (any CAPBridgeProtocol)?
    private var startupObserversRegistered = false

    private func registerNativePluginsIfNeeded() {
        guard let bridgeViewController = window?.rootViewController as? CAPBridgeViewController,
              let bridge = bridgeViewController.bridge else {
            return
        }

        // Only register plugins once per bridge instance.
        guard bridge !== nativePluginsBridge else {
            return
        }

        bridge.registerPluginInstance(FolderPickerPlugin())
        bridge.registerPluginInstance(FtpClientPlugin())
        bridge.registerPluginInstance(SecureStoragePlugin())
        bridge.registerPluginInstance(FeatureFlagsPlugin())
        bridge.registerPluginInstance(BackgroundExecutionPlugin())
        bridge.registerPluginInstance(DiagnosticsBridgePlugin())
        bridge.registerPluginInstance(MockC64UPlugin())
        nativePluginsBridge = bridge
    }

    private func registerStartupObserversIfNeeded() {
        if startupObserversRegistered {
            return
        }
        startupObserversRegistered = true

        NotificationCenter.default.addObserver(
            forName: UIWindow.didBecomeVisibleNotification,
            object: nil,
            queue: .main
        ) { _ in
            IOSStartupTrace.emit("app.uiwindow.first_created")
            IOSStartupTrace.emit("app.uiwindow.first_visible")
        }

        NotificationCenter.default.addObserver(
            forName: UIAccessibility.elementFocusedNotification,
            object: nil,
            queue: .main
        ) { _ in
            IOSStartupTrace.emit("app.accessibility.focus_event")
        }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        IOSStartupTrace.emit("app.process.first_spawn")
        registerStartupObserversIfNeeded()
        registerNativePluginsIfNeeded()
#if DEBUG
        IOSDebugHTTPServer.shared.start()
#endif
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        registerNativePluginsIfNeeded()
        DispatchQueue.main.async {
            IOSStartupTrace.emit("app.frame.first_rendered")
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
