import Foundation
import Capacitor
import UIKit
import Security
import os.log
import Network
import UniformTypeIdentifiers

enum IOSDiagnosticsLevel: String {
    case debug
    case info
    case warn
    case error
}

enum NativePluginError: LocalizedError {
    case invalidArgument(String)
    case unavailable(String)
    case operationFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidArgument(let message):
            return message
        case .unavailable(let message):
            return message
        case .operationFailed(let message):
            return message
        }
    }
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

private struct FolderPickerConstants {
    static let bookmarksKey = "ios.folderPicker.securityBookmarks"
    static let persistedUrisKey = "ios.folderPicker.persistedUris"
}

private struct FtpRequestOptions {
    let host: String
    let port: Int
    let username: String
    let password: String
    let path: String

    init(call: CAPPluginCall) throws {
        guard let host = call.getString("host"), !host.isEmpty else {
            throw NativePluginError.invalidArgument("host is required")
        }
        self.host = host
        self.port = call.getInt("port") ?? 21
        self.username = call.getString("username") ?? "user"
        self.password = call.getString("password") ?? ""
        self.path = call.getString("path") ?? "/"
    }
}

@objc(FolderPickerPlugin)
public final class FolderPickerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FolderPickerPlugin"
    public let jsName = "FolderPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listChildren", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPersistedUris", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFileFromTree", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeFileToTree", returnType: CAPPluginReturnPromise),
    ]

    private var pendingDirectoryCall: CAPPluginCall?
    private var pendingFileCall: CAPPluginCall?
    private var pendingFileExtensions: [String] = []
    private let operationQueue = DispatchQueue(label: "uk.gleissner.c64commander.folderpicker")

    @objc public func pickDirectory(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pendingDirectoryCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            IOSDiagnostics.log(.info, "Folder picker opening for directory selection", details: ["origin": "native", "operation": "pickDirectory"])
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    @objc public func pickFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pendingFileCall = call
            self.pendingFileExtensions = (call.getArray("extensions") as? [String] ?? [])
                .map { $0.replacingOccurrences(of: ".", with: "").lowercased() }
                .filter { !$0.isEmpty }

            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data, .item])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            IOSDiagnostics.log(.info, "Folder picker opening for file selection", details: ["origin": "native", "operation": "pickFile", "extensions": self.pendingFileExtensions])
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if let call = pendingDirectoryCall {
            pendingDirectoryCall = nil
            IOSDiagnostics.log(.info, "Folder picker cancelled by user", details: ["origin": "native", "operation": "pickDirectory"])
            call.reject("Folder selection canceled")
        }
        if let call = pendingFileCall {
            pendingFileCall = nil
            pendingFileExtensions = []
            IOSDiagnostics.log(.info, "File picker cancelled by user", details: ["origin": "native", "operation": "pickFile"])
            call.reject("File selection canceled")
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let selectedUrl = urls.first else {
            documentPickerWasCancelled(controller)
            return
        }

        if let call = pendingDirectoryCall {
            pendingDirectoryCall = nil
            resolvePickedDirectory(call: call, url: selectedUrl)
            return
        }
        if let call = pendingFileCall {
            let extensions = pendingFileExtensions
            pendingFileCall = nil
            pendingFileExtensions = []
            resolvePickedFile(call: call, url: selectedUrl, requiredExtensions: extensions)
        }
    }

    @objc public func listChildren(_ call: CAPPluginCall) {
        guard let treeUri = call.getString("treeUri"), !treeUri.isEmpty else {
            call.reject("treeUri is required")
            return
        }
        let relativePath = call.getString("path") ?? ""

        operationQueue.async {
            do {
                let safePath = try self.sanitizeRelativePath(relativePath)
                let treeUrl = try self.resolveScopedUrl(from: treeUri, mustBeDirectory: true)
                defer { treeUrl.stopAccessingSecurityScopedResource() }

                let targetUrl = safePath.isEmpty ? treeUrl : treeUrl.appendingPathComponent(safePath, isDirectory: true)
                let keys: [URLResourceKey] = [.nameKey, .isDirectoryKey, .fileSizeKey, .contentModificationDateKey]
                let children = try FileManager.default.contentsOfDirectory(at: targetUrl, includingPropertiesForKeys: keys)

                let entries = children.compactMap { child -> [String: Any]? in
                    do {
                        let values = try child.resourceValues(forKeys: Set(keys))
                        guard let name = values.name else { return nil }
                        let entryPath = safePath.isEmpty ? name : "\(safePath)/\(name)"
                        return [
                            "type": values.isDirectory == true ? "dir" : "file",
                            "name": name,
                            "path": entryPath,
                            "sizeBytes": values.fileSize as Any,
                            "modifiedAt": self.toIsoDate(values.contentModificationDate) as Any,
                        ]
                    } catch {
                        IOSDiagnostics.log(.warn, "Unable to read child metadata", details: ["origin": "native", "uri": child.absoluteString], error: error)
                        return nil
                    }
                }

                call.resolve(["entries": entries])
            } catch {
                IOSDiagnostics.log(.error, "List children failed", details: ["origin": "native", "operation": "listChildren", "treeUri": treeUri, "path": relativePath], error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func getPersistedUris(_ call: CAPPluginCall) {
        let persisted = UserDefaults.standard.dictionary(forKey: FolderPickerConstants.persistedUrisKey) as? [String: NSNumber] ?? [:]
        let uris = persisted.map { (uri, persistedAt) in
            [
                "uri": uri,
                "read": true,
                "write": true,
                "persistedAt": persistedAt.int64Value,
            ] as [String: Any]
        }
        call.resolve(["uris": uris])
    }

    @objc public func readFile(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), !uri.isEmpty else {
            call.reject("uri is required")
            return
        }

        operationQueue.async {
            do {
                let scoped = try self.resolveScopedUrl(from: uri, mustBeDirectory: false)
                defer { scoped.stopAccessingSecurityScopedResource() }

                let data = try Data(contentsOf: scoped)
                IOSDiagnostics.log(.debug, "File read completed", details: ["origin": "native", "operation": "readFile", "sizeBytes": data.count])
                call.resolve(["data": data.base64EncodedString()])
            } catch {
                IOSDiagnostics.log(.error, "File read failed", details: ["origin": "native", "operation": "readFile", "uri": uri], error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func readFileFromTree(_ call: CAPPluginCall) {
        guard let treeUri = call.getString("treeUri"), !treeUri.isEmpty else {
            call.reject("treeUri is required")
            return
        }
        guard let path = call.getString("path"), !path.isEmpty else {
            call.reject("path is required")
            return
        }

        operationQueue.async {
            do {
                let safePath = try self.sanitizeRelativePath(path)
                let root = try self.resolveScopedUrl(from: treeUri, mustBeDirectory: true)
                defer { root.stopAccessingSecurityScopedResource() }

                let fileUrl = root.appendingPathComponent(safePath, isDirectory: false)
                let data = try Data(contentsOf: fileUrl)
                IOSDiagnostics.log(.debug, "File read from tree completed", details: ["origin": "native", "operation": "readFileFromTree", "path": path, "sizeBytes": data.count])
                call.resolve(["data": data.base64EncodedString()])
            } catch {
                IOSDiagnostics.log(.error, "File read from tree failed", details: ["origin": "native", "operation": "readFileFromTree", "treeUri": treeUri, "path": path], error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func writeFileToTree(_ call: CAPPluginCall) {
        guard let treeUri = call.getString("treeUri"), !treeUri.isEmpty else {
            call.reject("treeUri is required")
            return
        }
        guard let path = call.getString("path"), !path.isEmpty else {
            call.reject("path is required")
            return
        }
        guard let base64 = call.getString("data"), !base64.isEmpty else {
            call.reject("data is required")
            return
        }

        let overwrite = call.getBool("overwrite") ?? true

        operationQueue.async {
            do {
                let safePath = try self.sanitizeRelativePath(path)
                let root = try self.resolveScopedUrl(from: treeUri, mustBeDirectory: true)
                defer { root.stopAccessingSecurityScopedResource() }

                let targetUrl = root.appendingPathComponent(safePath, isDirectory: false)
                let parent = targetUrl.deletingLastPathComponent()
                try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)

                if !overwrite && FileManager.default.fileExists(atPath: targetUrl.path) {
                    throw NativePluginError.operationFailed("Target file already exists")
                }

                guard let data = Data(base64Encoded: base64) else {
                    throw NativePluginError.invalidArgument("data must be valid base64")
                }

                try data.write(to: targetUrl, options: .atomic)
                let values = try targetUrl.resourceValues(forKeys: [.contentModificationDateKey])
                let response: [String: Any] = [
                    "uri": targetUrl.absoluteString,
                    "sizeBytes": data.count,
                    "modifiedAt": self.toIsoDate(values.contentModificationDate) as Any,
                ]
                call.resolve(response)
            } catch {
                IOSDiagnostics.log(.error, "Write file to tree failed", details: ["origin": "native", "operation": "writeFileToTree", "treeUri": treeUri, "path": path], error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    private func resolvePickedDirectory(call: CAPPluginCall, url: URL) {
        operationQueue.async {
            do {
                let persisted = try self.persistSecurityScopedUrl(url)
                let rootName = url.lastPathComponent
                IOSDiagnostics.log(.info, "Folder picker directory selected", details: [
                    "origin": "native",
                    "operation": "pickDirectory",
                    "rootName": rootName,
                    "permissionPersisted": persisted,
                ])
                call.resolve([
                    "treeUri": url.absoluteString,
                    "rootName": rootName,
                    "permissionPersisted": persisted,
                ])
            } catch {
                IOSDiagnostics.log(.error, "Folder picker directory resolution failed", details: ["origin": "native", "uri": url.absoluteString], error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    private func resolvePickedFile(call: CAPPluginCall, url: URL, requiredExtensions: [String]) {
        operationQueue.async {
            do {
                let lowercasedName = url.lastPathComponent.lowercased()
                if !requiredExtensions.isEmpty {
                    let matches = requiredExtensions.contains { lowercasedName.hasSuffix(".\($0)") }
                    if !matches {
                        IOSDiagnostics.log(.warn, "File picker extension mismatch", details: [
                            "origin": "native",
                            "operation": "pickFile",
                            "fileName": url.lastPathComponent,
                            "requiredExtensions": requiredExtensions,
                        ])
                        throw NativePluginError.operationFailed("Selected file does not match required extension.")
                    }
                }

                let persisted = try self.persistSecurityScopedUrl(url)
                let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])

                let parentUrl = url.deletingLastPathComponent()
                _ = try self.persistSecurityScopedUrl(parentUrl)

                IOSDiagnostics.log(.info, "File picker file selected", details: [
                    "origin": "native",
                    "operation": "pickFile",
                    "fileName": url.lastPathComponent,
                    "sizeBytes": values.fileSize as Any,
                    "permissionPersisted": persisted,
                ])
                call.resolve([
                    "uri": url.absoluteString,
                    "name": url.lastPathComponent,
                    "sizeBytes": values.fileSize as Any,
                    "modifiedAt": self.toIsoDate(values.contentModificationDate) as Any,
                    "permissionPersisted": persisted,
                    "parentTreeUri": parentUrl.absoluteString,
                    "parentRootName": parentUrl.lastPathComponent,
                ])
            } catch {
                IOSDiagnostics.log(.error, "Folder picker file resolution failed", details: ["origin": "native", "uri": url.absoluteString], error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    private func persistSecurityScopedUrl(_ url: URL) throws -> Bool {
        guard url.startAccessingSecurityScopedResource() else {
            IOSDiagnostics.log(.error, "Security-scoped bookmark permission rejected", details: ["origin": "native", "uri": url.absoluteString])
            throw NativePluginError.operationFailed("Persistable permission rejected")
        }
        defer { url.stopAccessingSecurityScopedResource() }

        let bookmarkData = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        var bookmarks = UserDefaults.standard.dictionary(forKey: FolderPickerConstants.bookmarksKey) as? [String: String] ?? [:]
        bookmarks[url.absoluteString] = bookmarkData.base64EncodedString()
        UserDefaults.standard.set(bookmarks, forKey: FolderPickerConstants.bookmarksKey)

        var persistedUris = UserDefaults.standard.dictionary(forKey: FolderPickerConstants.persistedUrisKey) as? [String: NSNumber] ?? [:]
        persistedUris[url.absoluteString] = NSNumber(value: Int64(Date().timeIntervalSince1970 * 1000))
        UserDefaults.standard.set(persistedUris, forKey: FolderPickerConstants.persistedUrisKey)
        IOSDiagnostics.log(.info, "Security-scoped bookmark persisted", details: ["origin": "native", "uri": url.absoluteString])
        return true
    }

    private func resolveScopedUrl(from uri: String, mustBeDirectory: Bool) throws -> URL {
        guard let url = URL(string: uri) else {
            throw NativePluginError.invalidArgument("Invalid URI")
        }

        if url.startAccessingSecurityScopedResource() {
            if mustBeDirectory {
                var isDirectory: ObjCBool = false
                if !FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) || !isDirectory.boolValue {
                    url.stopAccessingSecurityScopedResource()
                    throw NativePluginError.invalidArgument("Selected URI is not a directory")
                }
            }
            return url
        }

        let bookmarks = UserDefaults.standard.dictionary(forKey: FolderPickerConstants.bookmarksKey) as? [String: String] ?? [:]
        guard let encoded = bookmarks[uri],
              let bookmarkData = Data(base64Encoded: encoded) else {
            IOSDiagnostics.log(.error, "No persisted bookmark found for URI", details: ["origin": "native", "uri": uri])
            throw NativePluginError.unavailable("No persisted permission for URI")
        }

        var stale = false
        let scopedUrl = try URL(resolvingBookmarkData: bookmarkData, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        if stale {
            IOSDiagnostics.log(.warn, "Security-scoped bookmark is stale, refreshing", details: ["origin": "native", "uri": uri])
            _ = try persistSecurityScopedUrl(scopedUrl)
        }

        guard scopedUrl.startAccessingSecurityScopedResource() else {
            IOSDiagnostics.log(.error, "Persisted bookmark permission could not be activated", details: ["origin": "native", "uri": uri])
            throw NativePluginError.unavailable("Persisted permission could not be activated")
        }

        if mustBeDirectory {
            var isDirectory: ObjCBool = false
            if !FileManager.default.fileExists(atPath: scopedUrl.path, isDirectory: &isDirectory) || !isDirectory.boolValue {
                scopedUrl.stopAccessingSecurityScopedResource()
                throw NativePluginError.invalidArgument("Selected URI is not a directory")
            }
        }

        return scopedUrl
    }

    private func sanitizeRelativePath(_ input: String) throws -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return ""
        }
        let components = trimmed.split(separator: "/").map(String.init).filter { !$0.isEmpty }
        if components.contains("..") {
            throw NativePluginError.invalidArgument("path must not contain parent traversal")
        }
        return components.joined(separator: "/")
    }

    private func toIsoDate(_ date: Date?) -> String? {
        guard let date else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

@objc(FtpClientPlugin)
public final class FtpClientPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FtpClientPlugin"
    public let jsName = "FtpClient"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "uk.gleissner.c64commander.ftp")

    @objc public func listDirectory(_ call: CAPPluginCall) {
        queue.async {
            do {
                let options = try FtpRequestOptions(call: call)
                let session = FtpSession(host: options.host, port: options.port)
                defer { session.disconnect() }

                try session.connect()
                try session.login(username: options.username, password: options.password)
                let entries = try session.listDirectory(path: options.path)

                let payload = entries.map { entry in
                    [
                        "name": entry.name,
                        "path": entry.path,
                        "type": entry.type,
                        "size": entry.size as Any,
                        "modifiedAt": entry.modifiedAt as Any,
                    ] as [String: Any]
                }
                call.resolve(["entries": payload])
            } catch {
                IOSDiagnostics.log(.error, "FTP listDirectory failed", details: ["origin": "native"], error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func readFile(_ call: CAPPluginCall) {
        queue.async {
            do {
                var options = try FtpRequestOptions(call: call)
                guard let explicitPath = call.getString("path"), !explicitPath.isEmpty else {
                    throw NativePluginError.invalidArgument("path is required")
                }
                options = FtpRequestOptions(
                    host: options.host,
                    port: options.port,
                    username: options.username,
                    password: options.password,
                    path: explicitPath
                )

                let session = FtpSession(host: options.host, port: options.port)
                defer { session.disconnect() }
                try session.connect()
                try session.login(username: options.username, password: options.password)
                let data = try session.readFile(path: options.path)
                call.resolve([
                    "data": data.base64EncodedString(),
                    "sizeBytes": data.count,
                ])
            } catch {
                IOSDiagnostics.log(.error, "FTP readFile failed", details: ["origin": "native"], error: error)
                call.reject(error.localizedDescription)
            }
        }
    }
}

private extension FtpRequestOptions {
    init(host: String, port: Int, username: String, password: String, path: String) {
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.path = path
    }
}

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

    @objc public func start(_ call: CAPPluginCall) {
        IOSDiagnostics.log(.info, "BackgroundExecution start is a no-op on iOS", details: ["origin": "native"])
        call.resolve()
    }

    @objc public func stop(_ call: CAPPluginCall) {
        IOSDiagnostics.log(.info, "BackgroundExecution stop is a no-op on iOS", details: ["origin": "native"])
        call.resolve()
    }

    @objc public func setDueAtMs(_ call: CAPPluginCall) {
        let dueAtMs = call.getInt("dueAtMs")
        IOSDiagnostics.log(.debug, "BackgroundExecution setDueAtMs is a no-op on iOS", details: [
            "origin": "native",
            "dueAtMs": dueAtMs as Any,
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
