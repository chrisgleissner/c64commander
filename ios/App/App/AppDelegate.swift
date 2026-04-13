import UIKit
import Capacitor
import AVFoundation
import Security
import os.log
import Network

enum IOSDiagnosticsLevel: String {
    case debug
    case info
    case warn
    case error
}

enum IOSDiagnostics {
    static let notificationName = Notification.Name("C64CommanderDiagnosticsLog")
    static let logger = OSLog(subsystem: "uk.gleissner.c64commander", category: "native")

    static func log(_ level: IOSDiagnosticsLevel, _ message: String, details: [String: Any] = [:], error: Error? = nil) {
        var payload: [String: Any] = details
        payload["origin"] = payload["origin"] ?? "native"
        if let error {
            payload["error"] = [
                "name": String(describing: type(of: error)),
                "message": error.localizedDescription,
            ]
        }

        switch level {
        case .debug:
            os_log("%{public}@", log: logger, type: .debug, message)
        case .info:
            os_log("%{public}@", log: logger, type: .info, message)
        case .warn:
            os_log("%{public}@", log: logger, type: .default, message)
        case .error:
            os_log("%{public}@", log: logger, type: .error, message)
        }

        NotificationCenter.default.post(
            name: notificationName,
            object: nil,
            userInfo: [
                "level": level.rawValue,
                "message": message,
                "details": payload,
            ]
        )
    }
}

final class IOSDebugSnapshotStore {
    static let shared = IOSDebugSnapshotStore()

    private let queue = DispatchQueue(label: "uk.gleissner.c64commander.debugsnapshots")
    private var snapshots: [String: String] = [
        "trace": "[]",
        "actions": "[]",
        "log": "[]",
        "errorLog": "[]",
        "network": "{\"requests\":[],\"successCount\":0,\"failureCount\":0}",
    ]

    private init() {}

    func update(trace: String?, actions: String?, log: String?, errorLog: String?, network: String? = nil) {
        queue.sync {
            if let trace {
                snapshots["trace"] = trace
            }
            if let actions {
                snapshots["actions"] = actions
            }
            if let log {
                snapshots["log"] = log
            }
            if let errorLog {
                snapshots["errorLog"] = errorLog
            }
            if let network {
                snapshots["network"] = network
            }
        }
    }

    func payload(for key: String) -> String {
        queue.sync {
            snapshots[key] ?? "[]"
        }
    }
}

#if DEBUG
final class IOSDebugHTTPServer {
    static let shared = IOSDebugHTTPServer()

    private let queue = DispatchQueue(label: "uk.gleissner.c64commander.debughttp")
    private var listener: NWListener?
    private let port: NWEndpoint.Port = 39877

    private init() {}

    func start() {
        queue.async {
            guard self.listener == nil else {
                return
            }

            do {
                let parameters = NWParameters.tcp
                parameters.allowLocalEndpointReuse = true
                let listener = try NWListener(using: parameters, on: self.port)
                listener.newConnectionHandler = { [weak self] connection in
                    self?.handle(connection: connection)
                }
                listener.stateUpdateHandler = { state in
                    switch state {
                    case .failed(let error):
                        IOSDiagnostics.log(.error, "iOS debug HTTP server failed", details: ["origin": "native", "port": self.port.rawValue], error: error)
                    case .ready:
                        IOSDiagnostics.log(.info, "iOS debug HTTP server ready", details: ["origin": "native", "port": self.port.rawValue])
                    default:
                        break
                    }
                }
                listener.start(queue: self.queue)
                self.listener = listener
            } catch {
                IOSDiagnostics.log(.error, "Unable to start iOS debug HTTP server", details: ["origin": "native", "port": self.port.rawValue], error: error)
            }
        }
    }

    private func handle(connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, _, error in
            if let error {
                IOSDiagnostics.log(.warn, "Debug HTTP receive failed", details: ["origin": "native"], error: error)
                connection.cancel()
                return
            }
            guard let self else {
                connection.cancel()
                return
            }
            let request = String(data: data ?? Data(), encoding: .utf8) ?? ""
            let path = self.extractPath(from: request)
            let (status, body) = self.resolve(path: path)
            self.sendResponse(connection: connection, status: status, body: body)
        }
    }

    private func extractPath(from request: String) -> String {
        guard let firstLine = request.split(separator: "\r\n", maxSplits: 1, omittingEmptySubsequences: false).first else {
            return ""
        }
        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2 else {
            return ""
        }
        return String(parts[1])
    }

    private func resolve(path: String) -> (Int, String) {
        switch path {
        case "/debug/trace":
            return (200, IOSDebugSnapshotStore.shared.payload(for: "trace"))
        case "/debug/actions":
            return (200, IOSDebugSnapshotStore.shared.payload(for: "actions"))
        case "/debug/log":
            return (200, IOSDebugSnapshotStore.shared.payload(for: "log"))
        case "/debug/errorLog":
            return (200, IOSDebugSnapshotStore.shared.payload(for: "errorLog"))
        case "/debug/network":
            return (200, IOSDebugSnapshotStore.shared.payload(for: "network"))
        default:
            return (404, "{\"error\":\"not found\"}")
        }
    }

    private func sendResponse(connection: NWConnection, status: Int, body: String) {
        let statusText = status == 200 ? "OK" : "Not Found"
        let bodyData = Data(body.utf8)
        let response = "HTTP/1.1 \(status) \(statusText)\r\nContent-Type: application/json\r\nContent-Length: \(bodyData.count)\r\nConnection: close\r\n\r\n"
        let responseData = Data(response.utf8) + bodyData
        connection.send(content: responseData, completion: .contentProcessed { error in
            if let error {
                IOSDiagnostics.log(.warn, "Debug HTTP send failed", details: ["origin": "native"], error: error)
            }
            connection.cancel()
        })
    }
}
#endif

@objc(SecureStoragePlugin)
public final class SecureStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureStoragePlugin"
    public let jsName = "SecureStorage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setPassword", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPassword", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearPassword", returnType: CAPPluginReturnPromise),
    ]

    private let service = "uk.gleissner.c64commander.secure-storage"
    private let account = "c64u_password"

    @objc public func setPassword(_ call: CAPPluginCall) {
        guard let value = call.getString("value") else {
            call.reject("value is required")
            return
        }

        do {
            let data = Data(value.utf8)
            try upsertKeychainValue(data)
            call.resolve()
        } catch {
            IOSDiagnostics.log(.error, "Failed to set secure password", details: ["origin": "native"], error: error)
            call.reject(error.localizedDescription)
        }
    }

    @objc public func getPassword(_ call: CAPPluginCall) {
        do {
            let data = try readKeychainValue()
            let value = data.flatMap { String(data: $0, encoding: .utf8) }
            call.resolve(["value": value as Any])
        } catch {
            IOSDiagnostics.log(.error, "Failed to read secure password", details: ["origin": "native"], error: error)
            call.reject(error.localizedDescription)
        }
    }

    @objc public func clearPassword(_ call: CAPPluginCall) {
        do {
            try deleteKeychainValue()
            call.resolve()
        } catch {
            IOSDiagnostics.log(.error, "Failed to clear secure password", details: ["origin": "native"], error: error)
            call.reject(error.localizedDescription)
        }
    }

    private func keychainBaseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private func upsertKeychainValue(_ data: Data) throws {
        var updateQuery = keychainBaseQuery()
        let attributes: [String: Any] = [kSecValueData as String: data]

        let updateStatus = SecItemUpdate(updateQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        if updateStatus != errSecItemNotFound {
            throw NativePluginError.operationFailed("Keychain update failed with status \(updateStatus)")
        }

        updateQuery[kSecValueData as String] = data
        let addStatus = SecItemAdd(updateQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw NativePluginError.operationFailed("Keychain insert failed with status \(addStatus)")
        }
    }

    private func readKeychainValue() throws -> Data? {
        var query = keychainBaseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw NativePluginError.operationFailed("Keychain read failed with status \(status)")
        }
        return result as? Data
    }

    private func deleteKeychainValue() throws {
        let status = SecItemDelete(keychainBaseQuery() as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            return
        }
        throw NativePluginError.operationFailed("Keychain delete failed with status \(status)")
    }
}

@objc(FeatureFlagsPlugin)
public final class FeatureFlagsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FeatureFlagsPlugin"
    public let jsName = "FeatureFlags"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getFlag", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFlag", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAllFlags", returnType: CAPPluginReturnPromise),
    ]

    private let defaultsKey = "ios.featureFlags.store"

    @objc public func getFlag(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key is required")
            return
        }

        let store = readStore()
        if let value = store[key] {
            call.resolve(["value": value])
            return
        }
        call.resolve([:])
    }

    @objc public func setFlag(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key is required")
            return
        }
        guard let value = call.getBool("value") else {
            call.reject("value is required")
            return
        }

        var store = readStore()
        store[key] = value
        UserDefaults.standard.set(store, forKey: defaultsKey)
        call.resolve()
    }

    @objc public func getAllFlags(_ call: CAPPluginCall) {
        let keys = call.getArray("keys") as? [String] ?? []
        let store = readStore()
        var payload: [String: Bool] = [:]
        keys.forEach { key in
            if let value = store[key] {
                payload[key] = value
            }
        }
        call.resolve(["flags": payload])
    }

    private func readStore() -> [String: Bool] {
        UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: Bool] ?? [:]
    }
}

@objc(BackgroundExecutionPlugin)
public final class BackgroundExecutionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackgroundExecutionPlugin"
    public let jsName = "BackgroundExecution"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDueAtMs", returnType: CAPPluginReturnPromise),
    ]

    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var dueTimer: DispatchSourceTimer?

    private func clearDueTimer() {
        dueTimer?.cancel()
        dueTimer = nil
    }

    private func endBackgroundTaskIfNeeded() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    @objc public func start(_ call: CAPPluginCall) {
        if backgroundTask != .invalid {
            call.resolve()
            return
        }

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .default, options: [])
            try audioSession.setActive(true)
        } catch {
            IOSDiagnostics.log(.warn, "BackgroundExecution failed to configure AVAudioSession", details: ["origin": "native"], error: error)
        }

        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "C64CommanderBackgroundExecution") { [weak self] in
            IOSDiagnostics.log(.warn, "BackgroundExecution task expired on iOS", details: ["origin": "native"])
            self?.endBackgroundTaskIfNeeded()
        }

        if backgroundTask == .invalid {
            IOSDiagnostics.log(.warn, "BackgroundExecution start unavailable on iOS", details: ["origin": "native"])
        } else {
            IOSDiagnostics.log(.info, "BackgroundExecution task started on iOS", details: ["origin": "native"])
        }
        call.resolve()
    }

    @objc public func stop(_ call: CAPPluginCall) {
        clearDueTimer()
        endBackgroundTaskIfNeeded()
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            IOSDiagnostics.log(.warn, "BackgroundExecution failed to deactivate AVAudioSession", details: ["origin": "native"], error: error)
        }
        IOSDiagnostics.log(.info, "BackgroundExecution task stopped on iOS", details: ["origin": "native"])
        call.resolve()
    }

    @objc public func setDueAtMs(_ call: CAPPluginCall) {
        clearDueTimer()
        guard let dueAtMs = call.getInt("dueAtMs") else {
            IOSDiagnostics.log(.debug, "BackgroundExecution due timer cleared on iOS", details: ["origin": "native"])
            call.resolve()
            return
        }

        let nowMs = Int(Date().timeIntervalSince1970 * 1000)
        let delayMs = max(0, dueAtMs - nowMs)
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
        timer.schedule(deadline: .now() + .milliseconds(delayMs), repeating: .never)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            let firedAtMs = Int(Date().timeIntervalSince1970 * 1000)
            self.notifyListeners("backgroundAutoSkipDue", data: [
                "dueAtMs": dueAtMs,
                "firedAtMs": firedAtMs,
            ])
            IOSDiagnostics.log(.info, "BackgroundExecution due timer fired on iOS", details: [
                "origin": "native",
                "dueAtMs": dueAtMs,
                "firedAtMs": firedAtMs,
            ])
            self.clearDueTimer()
        }
        dueTimer = timer
        timer.resume()

        IOSDiagnostics.log(.debug, "BackgroundExecution due timer set on iOS", details: [
            "origin": "native",
            "dueAtMs": dueAtMs,
            "delayMs": delayMs,
        ])
        call.resolve()
    }
}

@objc(DiagnosticsBridgePlugin)
public final class DiagnosticsBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DiagnosticsBridgePlugin"
    public let jsName = "DiagnosticsBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "updateDebugSnapshots", returnType: CAPPluginReturnPromise),
    ]

    private var observer: NSObjectProtocol?

    public override func load() {
        observer = NotificationCenter.default.addObserver(
            forName: IOSDiagnostics.notificationName,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self else { return }
            guard let userInfo = notification.userInfo else {
                IOSDiagnostics.log(.warn, "Diagnostics notification missing payload", details: ["origin": "native"])
                return
            }
            let level = (userInfo["level"] as? String) ?? "info"
            let message = (userInfo["message"] as? String) ?? ""
            let details = (userInfo["details"] as? [String: Any]) ?? ["origin": "native"]
            self.notifyListeners("diagnosticsLog", data: [
                "level": level,
                "message": message,
                "details": details,
            ])
        }
    }

    @objc public func updateDebugSnapshots(_ call: CAPPluginCall) {
        IOSDebugSnapshotStore.shared.update(
            trace: call.getString("trace"),
            actions: call.getString("actions"),
            log: call.getString("log"),
            errorLog: call.getString("errorLog"),
            network: call.getString("network")
        )
        call.resolve()
    }

    deinit {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
            self.observer = nil
        }
    }
}

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
        bridge.registerPluginInstance(TelnetSocketPlugin())
        bridge.registerPluginInstance(HvscIngestionPlugin())
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
