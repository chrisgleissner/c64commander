import Foundation
import Capacitor

private struct FtpRequestOptions {
    let host: String
    let port: Int
    let username: String
    let password: String
    let path: String
    let timeout: TimeInterval
    let connectTimeout: TimeInterval
    let traceDetails: [String: Any]

    init(call: CAPPluginCall) throws {
        guard let host = call.getString("host"), !host.isEmpty else {
            throw NativePluginError.invalidArgument("host is required")
        }
        self.host = host
        self.port = call.getInt("port") ?? 21
        self.username = call.getString("username") ?? "user"
        self.password = call.getString("password") ?? ""
        self.path = call.getString("path") ?? "/"
        self.timeout = FtpRequestOptions.resolveTimeout(call.getInt("timeoutMs"))
        self.connectTimeout = FtpRequestOptions.resolveTimeout(call.getInt("connectTimeoutMs"), defaultMs: 1_500)
        self.traceDetails = FtpRequestOptions.resolveTraceDetails(call.getObject("traceContext"))
    }
}

private struct FtpWriteRequestOptions {
    let request: FtpRequestOptions
    let data: Data

    init(call: CAPPluginCall) throws {
        self.request = try FtpRequestOptions(call: call)
        guard let encoded = call.getString("data"), !encoded.isEmpty else {
            throw NativePluginError.invalidArgument("data is required")
        }
        guard let data = Data(base64Encoded: encoded) else {
            throw NativePluginError.invalidArgument("data must be valid base64")
        }
        self.data = data
    }
}

/*
 * Cancellation for an in-flight `readFile`.
 *
 * The plugin runs every FTP call on one serial queue, so a `cancelRead` dispatched onto that queue
 * would sit behind the very read it is meant to stop. Instead the cancelling call sets a flag from
 * its own thread and the read loop notices it on its next poll, which is at most 50 ms later. The
 * alternative - closing the streams from another thread - races `disconnect()`, which nils them
 * while the read loop is using them.
 */
final class FtpReadCancellationToken {
    private let lock = NSLock()
    private var cancelled = false

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        defer { lock.unlock() }
        cancelled = true
    }
}

final class FtpReadCancellationRegistry {
    static let shared = FtpReadCancellationRegistry()

    private let lock = NSLock()
    private var tokens: [String: FtpReadCancellationToken] = [:]

    func register(requestId: String) -> FtpReadCancellationToken {
        let token = FtpReadCancellationToken()
        lock.lock()
        defer { lock.unlock() }
        tokens[requestId] = token
        return token
    }

    func release(requestId: String) {
        lock.lock()
        defer { lock.unlock() }
        tokens.removeValue(forKey: requestId)
    }

    /* Returns false when the read already finished, which is not an error for any caller. */
    @discardableResult
    func cancel(requestId: String) -> Bool {
        lock.lock()
        let token = tokens[requestId]
        lock.unlock()
        token?.cancel()
        return token != nil
    }
}

@objc(FtpClientPlugin)
public final class FtpClientPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FtpClientPlugin"
    public let jsName = "FtpClient"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "makeDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pingFtp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelRead", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "uk.gleissner.c64commander.ftp")

    @objc public func listDirectory(_ call: CAPPluginCall) {
        queue.async {
            do {
                let options = try FtpRequestOptions(call: call)
                let session = FtpSession(
                    host: options.host,
                    port: options.port,
                    timeout: options.timeout,
                    connectTimeout: options.connectTimeout
                )
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
                let details = FtpRequestOptions.failureDetails(for: call, operation: "listDirectory")
                IOSDiagnostics.log(.error, "FTP listDirectory failed", details: details, error: error)
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
                    path: explicitPath,
                    timeout: options.timeout,
                    connectTimeout: options.connectTimeout,
                    traceDetails: options.traceDetails
                )

                let session = FtpSession(
                    host: options.host,
                    port: options.port,
                    timeout: options.timeout,
                    connectTimeout: options.connectTimeout
                )
                defer { session.disconnect() }
                /*
                 * The control channel keeps the clamped `timeout`; the bulk read gets the idle
                 * timeout, which honours `timeoutMs: 0` as "no idle timeout". The songlengths
                 * read from the Ultimate sends exactly that (HARD27-012).
                 */
                session.transferTimeout = FtpRequestOptions.resolveTransferTimeout(call.getInt("timeoutMs"))
                /*
                 * The TypeScript client only sends a requestId when the read is cancellable
                 * (it has an abort signal or a progress listener), so an ordinary read
                 * registers nothing.
                 */
                let requestId = call.getString("requestId")
                if let requestId {
                    session.cancellationToken = FtpReadCancellationRegistry.shared.register(requestId: requestId)
                }
                defer {
                    if let requestId {
                        FtpReadCancellationRegistry.shared.release(requestId: requestId)
                    }
                }
                try session.connect()
                try session.login(username: options.username, password: options.password)
                let data = try session.readFile(path: options.path)
                call.resolve([
                    "data": data.base64EncodedString(),
                    "sizeBytes": data.count,
                ])
            } catch {
                let details = FtpRequestOptions.failureDetails(for: call, operation: "readFile")
                IOSDiagnostics.log(.error, "FTP readFile failed", details: details, error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    /*
     * Deliberately not dispatched onto `queue`: that queue is serialised behind the read this is
     * meant to stop, so a cancel posted to it would run only after the read completed. Resolves
     * either way - cancelling a read that already finished is not an error for any caller
     * (HARD27-003).
     */
    @objc public func cancelRead(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId"), !requestId.isEmpty else {
            call.reject("requestId is required")
            return
        }
        let cancelled = FtpReadCancellationRegistry.shared.cancel(requestId: requestId)
        IOSDiagnostics.log(
            .debug,
            cancelled ? "FTP read cancelled" : "FTP read already finished when cancelled",
            details: ["origin": "native", "requestId": requestId]
        )
        call.resolve()
    }

    @objc public func writeFile(_ call: CAPPluginCall) {
        queue.async {
            do {
                let options = try FtpWriteRequestOptions(call: call)
                let session = FtpSession(
                    host: options.request.host,
                    port: options.request.port,
                    timeout: options.request.timeout,
                    connectTimeout: options.request.connectTimeout
                )
                defer { session.disconnect() }
                try session.connect()
                try session.login(username: options.request.username, password: options.request.password)
                try session.writeFile(path: options.request.path, data: options.data)
                call.resolve([
                    "sizeBytes": options.data.count,
                ])
            } catch {
                let details = FtpRequestOptions.failureDetails(for: call, operation: "writeFile")
                IOSDiagnostics.log(.error, "FTP writeFile failed", details: details, error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func makeDirectory(_ call: CAPPluginCall) {
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
                    path: explicitPath,
                    timeout: options.timeout,
                    connectTimeout: options.connectTimeout,
                    traceDetails: options.traceDetails
                )

                let session = FtpSession(
                    host: options.host,
                    port: options.port,
                    timeout: options.timeout,
                    connectTimeout: options.connectTimeout
                )
                defer { session.disconnect() }
                try session.connect()
                try session.login(username: options.username, password: options.password)
                let created = try session.makeDirectory(path: options.path)
                call.resolve(["created": created])
            } catch {
                let details = FtpRequestOptions.failureDetails(for: call, operation: "makeDirectory")
                IOSDiagnostics.log(.error, "FTP makeDirectory failed", details: details, error: error)
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func pingFtp(_ call: CAPPluginCall) {
        queue.async {
            do {
                let options = try FtpRequestOptions(call: call)
                let session = FtpSession(
                    host: options.host,
                    port: options.port,
                    timeout: options.timeout,
                    connectTimeout: options.connectTimeout
                )
                defer { session.disconnect() }

                try session.connect()
                try session.login(username: options.username, password: options.password)
                try session.noop()
                call.resolve(["ok": true])
            } catch {
                let details = FtpRequestOptions.failureDetails(for: call, operation: "pingFtp")
                IOSDiagnostics.log(.error, "FTP ping failed", details: details, error: error)
                call.reject(error.localizedDescription)
            }
        }
    }
}

private extension FtpRequestOptions {
    init(
        host: String,
        port: Int,
        username: String,
        password: String,
        path: String,
        timeout: TimeInterval,
        connectTimeout: TimeInterval,
        traceDetails: [String: Any]
    ) {
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.path = path
        self.timeout = timeout
        self.connectTimeout = connectTimeout
        self.traceDetails = traceDetails
    }

    /*
     * The data-transfer timeout, which is not the same thing as `resolveTimeout`.
     *
     * `timeoutMs == 0` explicitly means "no idle timeout" - the songlengths read from the
     * Ultimate sends it, because a truncating timeout can wedge the firmware's FTP data channel.
     * `resolveTimeout` clamped that to 1 s, so the read returned a truncated buffer and the
     * songlengths import reported failure. A positive value is an idle timeout bounded the same
     * way Android bounds it, to 10 minutes rather than the 60 s a whole-transfer deadline needed
     * (HARD27-012).
     *
     * Returns nil for "no idle timeout".
     */
    static func resolveTransferTimeout(_ timeoutMs: Int?, defaultMs: Int = 8_000) -> TimeInterval? {
        guard let timeoutMs else { return TimeInterval(defaultMs) / 1_000 }
        if timeoutMs == 0 { return nil }
        let clampedMs = min(max(timeoutMs, 1_000), 600_000)
        return TimeInterval(clampedMs) / 1_000
    }

    static func resolveTimeout(_ timeoutMs: Int?, defaultMs: Int = 8_000) -> TimeInterval {
        let clampedMs = min(max(timeoutMs ?? defaultMs, 1_000), 60_000)
        return TimeInterval(clampedMs) / 1_000
    }

    static func resolveTraceDetails(_ trace: [AnyHashable: Any]?) -> [String: Any] {
        guard let trace else { return [:] }

        let knownKeys = [
            "correlationId",
            "trackInstanceId",
            "playlistItemId",
            "sourceKind",
            "localAccessMode",
            "lifecycleState",
        ]

        return knownKeys.reduce(into: [String: Any]()) { details, key in
            if let value = trace[key], !(value is NSNull) {
                details[key] = value
            }
        }
    }

    static func failureDetails(for call: CAPPluginCall, operation: String) -> [String: Any] {
        let timeout = resolveTimeout(call.getInt("timeoutMs"))
        let options = (try? FtpRequestOptions(call: call))
        var details: [String: Any] = [
            "origin": "native",
            "operation": operation,
            "host": call.getString("host") ?? "",
            "port": call.getInt("port") ?? 21,
            "path": call.getString("path") ?? "/",
            "timeoutMs": Int(timeout * 1_000),
            "connectTimeoutMs": Int(resolveTimeout(call.getInt("connectTimeoutMs"), defaultMs: 1_500) * 1_000),
        ]
        if let options {
            details.merge(options.traceDetails) { _, new in new }
        } else {
            details.merge(resolveTraceDetails(call.getObject("traceContext"))) { _, new in new }
        }
        return details
    }
}

struct FtpEntry {
    let name: String
    let path: String
    let type: String
    let size: Int?
    let modifiedAt: String?
}

final class FtpSession {
    private let host: String
    private let port: Int
    private let timeout: TimeInterval
    private let connectTimeout: TimeInterval

    private var inputStream: InputStream?
    private var outputStream: OutputStream?
    /* Set only for a cancellable read; the data session inherits it in `readFile`. */
    var cancellationToken: FtpReadCancellationToken?
    /*
     * The idle timeout for a bulk data transfer, which the control channel's `timeout` is not:
     * `timeout` bounds one command/response exchange, while this bounds a gap between chunks and
     * is reset by every chunk that arrives. nil means no idle timeout. The data session inherits
     * it in `readFile` (HARD27-012).
     */
    var transferTimeout: TimeInterval?

    init(host: String, port: Int, timeout: TimeInterval = 30, connectTimeout: TimeInterval? = nil) {
        self.host = host
        self.port = port
        self.timeout = timeout
        self.connectTimeout = connectTimeout ?? timeout
        self.transferTimeout = timeout
    }

    func connect() throws {
        var readStream: Unmanaged<CFReadStream>?
        var writeStream: Unmanaged<CFWriteStream>?
        CFStreamCreatePairWithSocketToHost(nil, host as CFString, UInt32(port), &readStream, &writeStream)

        guard let read = readStream?.takeRetainedValue(),
              let write = writeStream?.takeRetainedValue() else {
            throw NativePluginError.unavailable("Failed to create FTP socket streams")
        }

        inputStream = read
        outputStream = write
        inputStream?.open()
        outputStream?.open()

        _ = try readResponse(expectPrefix: [220], timeout: connectTimeout)
    }

    func disconnect() {
        if let input = inputStream {
            if input.streamStatus != .closed && input.streamStatus != .notOpen {
                input.close()
            }
            if let error = input.streamError {
                IOSDiagnostics.log(.warn, "FTP input stream error during disconnect", details: ["origin": "native", "host": host, "port": "\(port)"], error: error)
            }
        }

        if let output = outputStream {
            if output.streamStatus != .closed && output.streamStatus != .notOpen {
                output.close()
            }
            if let error = output.streamError {
                IOSDiagnostics.log(.warn, "FTP output stream error during disconnect", details: ["origin": "native", "host": host, "port": "\(port)"], error: error)
            }
        }
        inputStream = nil
        outputStream = nil
    }

    func login(username: String, password: String) throws {
        let userResponse = try sendAndRead("USER \(username)")
        if userResponse.code == 331 {
            let passResponse = try sendAndRead("PASS \(password)")
            guard passResponse.code == 230 else {
                throw NativePluginError.operationFailed("FTP login failed")
            }
        } else if userResponse.code != 230 {
            throw NativePluginError.operationFailed("FTP login failed")
        }

        _ = try sendAndRead("TYPE I", expected: [200])
    }

    func noop() throws {
        _ = try sendAndRead("NOOP", expected: [200])
    }

    func listDirectory(path: String) throws -> [FtpEntry] {
        do {
            return try listDirectory(path: path, command: "MLSD")
        } catch {
            IOSDiagnostics.log(.warn, "FTP MLSD failed; falling back to LIST", details: ["origin": "native", "path": path], error: error)
            return try listDirectory(path: path, command: "LIST")
        }
    }

    func readFile(path: String) throws -> Data {
        let passiveAddress = try openPassiveDataChannel()
        let dataSession = FtpSession(host: passiveAddress.host, port: passiveAddress.port, timeout: timeout)
        // The bytes arrive on the data channel, so that is the session the cancel and the idle
        // timeout both have to reach.
        dataSession.cancellationToken = cancellationToken
        dataSession.transferTimeout = transferTimeout
        try dataSession.connectForData()

        _ = try sendAndRead("RETR \(path)", expectedPrefix: [125, 150])
        let bytes = try dataSession.readAllBytes()
        dataSession.disconnect()
        _ = try readResponse(expectPrefix: [226, 250])
        return Data(bytes)
    }

    func writeFile(path: String, data: Data) throws {
        let passiveAddress = try openPassiveDataChannel()
        let dataSession = FtpSession(host: passiveAddress.host, port: passiveAddress.port, timeout: timeout)
        try dataSession.connectForData()

        _ = try sendAndRead("STOR \(path)", expectedPrefix: [125, 150])
        try dataSession.writeAllBytes(data)
        dataSession.disconnect()
        _ = try readResponse(expectPrefix: [226, 250])
    }

    /// Creates exactly one directory at `path`.
    ///
    /// Returns `true` when the server created it, and `false` when it was
    /// already there — a pre-existing directory is the state the caller wants,
    /// not a failure. A failed MKD is followed by a CWD probe: a CWD that
    /// succeeds proves the path is a directory, while anything else (permission
    /// denied, an existing FILE at that path) throws with the server's own MKD
    /// reply.
    func makeDirectory(path: String) throws -> Bool {
        let response = try sendAndRead("MKD \(path)")
        if response.code == 257 || response.code == 250 {
            return true
        }

        let probe = try sendAndRead("CWD \(path)")
        if probe.code == 250 || probe.code == 200 {
            return false
        }

        throw NativePluginError.operationFailed(response.message)
    }

    private func listDirectory(path: String, command: String) throws -> [FtpEntry] {
        let passiveAddress = try openPassiveDataChannel()
        let dataSession = FtpSession(host: passiveAddress.host, port: passiveAddress.port, timeout: timeout)
        try dataSession.connectForData()

        _ = try sendAndRead("\(command) \(path)", expectedPrefix: [125, 150])
        let lines = try dataSession.readAllLines()
        dataSession.disconnect()
        _ = try readResponse(expectPrefix: [226, 250])

        return lines.compactMap { line in
            if command == "MLSD" {
                return Self.parseMLSD(line: line, basePath: path)
            }
            return Self.parseLIST(line: line, basePath: path)
        }
    }

    private func connectForData() throws {
        var readStream: Unmanaged<CFReadStream>?
        var writeStream: Unmanaged<CFWriteStream>?
        CFStreamCreatePairWithSocketToHost(nil, host as CFString, UInt32(port), &readStream, &writeStream)

        guard let read = readStream?.takeRetainedValue(),
              let write = writeStream?.takeRetainedValue() else {
            throw NativePluginError.unavailable("Failed to create FTP data streams")
        }

        inputStream = read
        outputStream = write
        inputStream?.open()
        outputStream?.open()
    }

    private func openPassiveDataChannel() throws -> (host: String, port: Int) {
        let response = try sendAndRead("PASV", expected: [227])
        guard let start = response.message.firstIndex(of: "("),
              let end = response.message.firstIndex(of: ")") else {
            throw NativePluginError.operationFailed("Invalid FTP PASV response")
        }
        let payload = response.message[response.message.index(after: start)..<end]
        let numbers = payload.split(separator: ",").compactMap { Int($0) }
        guard numbers.count == 6 else {
            throw NativePluginError.operationFailed("Invalid FTP PASV address payload")
        }
        let dataHost = "\(numbers[0]).\(numbers[1]).\(numbers[2]).\(numbers[3])"
        let dataPort = numbers[4] * 256 + numbers[5]
        return (dataHost, dataPort)
    }

    private func sendAndRead(_ command: String, expected: [Int] = [], expectedPrefix: [Int] = []) throws -> (code: Int, message: String) {
        try writeLine(command)
        if !expected.isEmpty {
            return try readResponse(expect: expected)
        }
        if !expectedPrefix.isEmpty {
            return try readResponse(expectPrefix: expectedPrefix)
        }
        return try readResponse()
    }

    private func writeLine(_ line: String) throws {
        guard let outputStream else {
            throw NativePluginError.unavailable("FTP output stream unavailable")
        }

        let bytes = Array((line + "\r\n").utf8)
        var offset = 0
        let deadline = Date().addingTimeInterval(timeout)

        while offset < bytes.count {
            if Date() > deadline {
                throw NativePluginError.operationFailed("FTP command write timed out")
            }
            if !outputStream.hasSpaceAvailable {
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
                continue
            }

            let written = bytes.withUnsafeBytes { rawBuffer in
                outputStream.write(rawBuffer.baseAddress!.advanced(by: offset).assumingMemoryBound(to: UInt8.self), maxLength: bytes.count - offset)
            }
            if written < 0 {
                throw outputStream.streamError ?? NativePluginError.operationFailed("FTP command write failed")
            }
            offset += written
        }
    }

    private func readResponse(
        expect: [Int]? = nil,
        expectPrefix: [Int]? = nil,
        timeout responseTimeout: TimeInterval? = nil
    ) throws -> (code: Int, message: String) {
        var lines: [String] = []
        var responseCode: Int?
        var multilineCode: Int?
        let deadline = Date().addingTimeInterval(responseTimeout ?? timeout)

        while Date() <= deadline {
            let line = try readLine(deadline: deadline)
            lines.append(line)
            guard line.count >= 3, let code = Int(line.prefix(3)) else {
                continue
            }

            if responseCode == nil {
                responseCode = code
                if line.count > 3 {
                    let marker = line[line.index(line.startIndex, offsetBy: 3)]
                    if marker == "-" {
                        multilineCode = code
                        continue
                    }
                }
                break
            }

            if let multilineCode, line.hasPrefix("\(multilineCode) ") {
                responseCode = multilineCode
                break
            }
        }

        guard let code = responseCode else {
            throw NativePluginError.operationFailed("FTP response timed out")
        }

        if let expect, !expect.contains(code) {
            throw NativePluginError.operationFailed("FTP command failed (\(code))")
        }
        if let expectPrefix, !expectPrefix.contains(code) {
            throw NativePluginError.operationFailed("FTP command failed (\(code))")
        }

        return (code, lines.joined(separator: "\n"))
    }

    private func readLine(deadline: Date) throws -> String {
        guard let inputStream else {
            throw NativePluginError.unavailable("FTP input stream unavailable")
        }

        var buffer = [UInt8](repeating: 0, count: 1)
        var lineBytes: [UInt8] = []

        while Date() <= deadline {
            if !inputStream.hasBytesAvailable {
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
                continue
            }

            let readCount = inputStream.read(&buffer, maxLength: 1)
            if readCount < 0 {
                throw inputStream.streamError ?? NativePluginError.operationFailed("FTP stream read failed")
            }
            if readCount == 0 {
                break
            }

            lineBytes.append(buffer[0])
            if buffer[0] == 0x0A {
                break
            }
        }

        if lineBytes.isEmpty {
            throw NativePluginError.operationFailed("FTP response read timeout")
        }

        let raw = String(decoding: lineBytes, as: UTF8.self)
        return raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func readAllBytes() throws -> [UInt8] {
        guard let inputStream else {
            throw NativePluginError.unavailable("FTP data input stream unavailable")
        }

        var bytes: [UInt8] = []
        var buffer = [UInt8](repeating: 0, count: 4096)
        /*
         * An idle deadline, reset by every chunk, rather than one deadline for the whole
         * transfer. A whole-transfer deadline capped every read at 60 s of wall time no matter
         * how well it was progressing, so a large disk image over the c64u's slow FTP failed
         * where Android succeeded (HARD27-012).
         */
        var deadline = FtpSession.idleDeadline(from: Date(), timeout: transferTimeout)

        while Date() <= deadline {
            if cancellationToken?.isCancelled == true {
                throw NativePluginError.operationFailed("FTP read cancelled")
            }
            if !inputStream.hasBytesAvailable {
                if inputStream.streamStatus == .atEnd {
                    break
                }
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
                continue
            }

            let readCount = inputStream.read(&buffer, maxLength: buffer.count)
            if readCount < 0 {
                throw inputStream.streamError ?? NativePluginError.operationFailed("FTP data read failed")
            }
            if readCount == 0 {
                break
            }
            bytes.append(contentsOf: buffer.prefix(readCount))
            /*
             * Base64 encoding the buffered file costs another ~1.33x on top of the raw bytes, so
             * an uncapped read of a large file (a .dnp disk pack, a firmware image) drives the app
             * into memory pressure. Same 32 MiB cap and same message as Android (HARD9-044).
             */
            if bytes.count > FtpSession.maxReadFileBytes {
                throw NativePluginError.operationFailed(
                    "File exceeds the maximum readable size (\(FtpSession.maxReadFileBytes / (1024 * 1024))MB)"
                )
            }
            deadline = FtpSession.idleDeadline(from: Date(), timeout: transferTimeout)
        }

        return bytes
    }

    static let maxReadFileBytes = 32 * 1024 * 1024

    /*
     * `Date.distantFuture` rather than a very large interval: adding one to a Date overflows on
     * some inputs, and "no idle timeout" is exactly what distantFuture expresses.
     */
    static func idleDeadline(from now: Date, timeout: TimeInterval?) -> Date {
        guard let timeout else { return Date.distantFuture }
        return now.addingTimeInterval(timeout)
    }

    private func readAllLines() throws -> [String] {
        let bytes = try readAllBytes()
        guard !bytes.isEmpty else { return [] }
        let text = String(decoding: bytes, as: UTF8.self)
        return text
            .split(whereSeparator: { $0.isNewline })
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func writeAllBytes(_ data: Data) throws {
        guard let outputStream else {
            throw NativePluginError.unavailable("FTP data output stream unavailable")
        }

        let bytes = [UInt8](data)
        var offset = 0
        let deadline = Date().addingTimeInterval(timeout)

        while offset < bytes.count {
            if Date() > deadline {
                throw NativePluginError.operationFailed("FTP data write timed out")
            }
            if !outputStream.hasSpaceAvailable {
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
                continue
            }

            let written = bytes.withUnsafeBytes { rawBuffer in
                outputStream.write(
                    rawBuffer.baseAddress!.advanced(by: offset).assumingMemoryBound(to: UInt8.self),
                    maxLength: bytes.count - offset
                )
            }
            if written < 0 {
                throw outputStream.streamError ?? NativePluginError.operationFailed("FTP data write failed")
            }
            offset += written
        }
    }

    private static func parseMLSD(line: String, basePath: String) -> FtpEntry? {
        guard let separator = line.firstIndex(of: " ") else {
            return nil
        }

        let factsPart = line[..<separator]
        let name = line[line.index(after: separator)...].trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || name == "." || name == ".." {
            return nil
        }

        var entryType = "file"
        var entrySize: Int?
        var modifiedAt: String?

        for fact in factsPart.split(separator: ";") {
            let pair = fact.split(separator: "=", maxSplits: 1).map(String.init)
            guard pair.count == 2 else { continue }
            let key = pair[0].lowercased()
            let value = pair[1]
            if key == "type" {
                if value.lowercased().contains("dir") {
                    entryType = "dir"
                }
            } else if key == "size" {
                entrySize = Int(value)
            } else if key == "modify" {
                modifiedAt = parseFtpModifyTimestamp(value)
            }
        }

        return FtpEntry(
            name: name,
            path: buildPath(base: basePath, name: name),
            type: entryType,
            size: entrySize,
            modifiedAt: modifiedAt
        )
    }

    private static func parseLIST(line: String, basePath: String) -> FtpEntry? {
        let parts = line.split(whereSeparator: { $0.isWhitespace })
        guard parts.count >= 9 else { return nil }

        let typeToken = parts[0]
        let name = parts[8...].joined(separator: " ")
        if name == "." || name == ".." || name.isEmpty {
            return nil
        }

        let entryType = typeToken.first == "d" ? "dir" : "file"
        let size = Int(parts[4])

        return FtpEntry(
            name: name,
            path: buildPath(base: basePath, name: name),
            type: entryType,
            size: size,
            modifiedAt: nil
        )
    }

    private static func parseFtpModifyTimestamp(_ raw: String) -> String? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)

        if raw.count >= 14 {
            formatter.dateFormat = "yyyyMMddHHmmss"
            if let date = formatter.date(from: String(raw.prefix(14))) {
                return ISO8601DateFormatter().string(from: date)
            }
        }

        return nil
    }

    private static func buildPath(base: String, name: String) -> String {
        if base.isEmpty || base == "/" {
            return "/\(name)"
        }
        if base.hasSuffix("/") {
            return "\(base)\(name)"
        }
        return "\(base)/\(name)"
    }
}
