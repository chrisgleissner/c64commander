import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

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


private struct FolderPickerConstants {
    static let bookmarksKey = "ios.folderPicker.securityBookmarks"
    static let persistedUrisKey = "ios.folderPicker.persistedUris"
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

    private func makeDirectoryPicker() -> UIDocumentPickerViewController {
        if #available(iOS 14.0, *) {
            return UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
        }
        return UIDocumentPickerViewController(documentTypes: ["public.folder"], in: .open)
    }

    private func makeFilePicker() -> UIDocumentPickerViewController {
        if #available(iOS 14.0, *) {
            return UIDocumentPickerViewController(forOpeningContentTypes: [.data, .item])
        }
        return UIDocumentPickerViewController(documentTypes: ["public.data", "public.item"], in: .open)
    }

    @objc public func pickDirectory(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pendingDirectoryCall = call
            let picker = self.makeDirectoryPicker()
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

            let picker = self.makeFilePicker()
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
