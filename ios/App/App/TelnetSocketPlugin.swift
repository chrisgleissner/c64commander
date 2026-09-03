import Foundation
import Capacitor

@objc(TelnetSocketPlugin)
public final class TelnetSocketPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TelnetSocket"
    public let jsName = "TelnetSocket"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isConnected", returnType: CAPPluginReturnPromise),
    ]

    private let workQueue = DispatchQueue(label: "uk.gleissner.c64commander.telnet")
    private let logOrigin = "TelnetSocketPlugin"
    private let defaultConnectTimeout: TimeInterval = 5
    private let defaultWriteTimeout: TimeInterval = 5

    private var inputStream: InputStream?
    private var outputStream: OutputStream?
    private var connectedHost: String?
    private var connectedPort: Int?

    @objc public func connect(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), !host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("host is required")
            return
        }

        let port = call.getInt("port") ?? 23
        let timeoutMs = call.getInt("timeoutMs") ?? Int(defaultConnectTimeout * 1000)
        guard case .success(let validatedPort) = TelnetRequestValidation.resolvePort(port) else {
            call.reject("port must be between 1 and 65535")
            return
        }
        guard case .success(let validatedTimeoutMs) = TelnetRequestValidation.resolveTimeoutMs(timeoutMs) else {
            call.reject("timeoutMs must be greater than 0")
            return
        }

        workQueue.async {
            do {
                self.closeStreams()
                try self.openStreams(host: host, port: validatedPort, timeout: TimeInterval(validatedTimeoutMs) / 1000)
                self.connectedHost = host
                self.connectedPort = validatedPort
                IOSDiagnostics.log(.info, "Telnet connected", details: [
                    "origin": self.logOrigin,
                    "host": host,
                    "port": validatedPort,
                ])
                call.resolve()
            } catch {
                IOSDiagnostics.log(.error, "Telnet connect failed", details: [
                    "origin": self.logOrigin,
                    "host": host,
                    "port": validatedPort,
                ], error: error)
                self.closeStreams()
                call.reject("Connection failed: \(error.localizedDescription)")
            }
        }
    }

    @objc public func disconnect(_ call: CAPPluginCall) {
        workQueue.async {
            self.closeStreams()
            IOSDiagnostics.log(.info, "Telnet disconnected", details: ["origin": self.logOrigin])
            call.resolve()
        }
    }

    @objc public func send(_ call: CAPPluginCall) {
        guard let dataBase64 = call.getString("data"), let data = Data(base64Encoded: dataBase64) else {
            call.reject("data must be valid base64")
            return
        }

        workQueue.async {
            do {
                guard self.isConnectionOpen else {
                    throw NativePluginError.unavailable("Not connected")
                }
                try self.writeAllBytes(data, timeout: self.defaultWriteTimeout)
                call.resolve()
            } catch {
                IOSDiagnostics.log(.error, "Telnet send failed", details: ["origin": self.logOrigin], error: error)
                self.closeStreams()
                call.reject("Send failed: \(error.localizedDescription)")
            }
        }
    }

    @objc public func read(_ call: CAPPluginCall) {
        let timeoutMs = call.getInt("timeoutMs") ?? 500

        workQueue.async {
            do {
                guard self.isConnectionOpen else {
                    throw NativePluginError.unavailable("Not connected")
                }
                let bytes = try self.readAvailableBytes(timeout: TimeInterval(timeoutMs) / 1000)
                call.resolve([
                    "data": bytes.base64EncodedString(),
                ])
            } catch {
                IOSDiagnostics.log(.error, "Telnet read failed", details: ["origin": self.logOrigin], error: error)
                self.closeStreams()
                call.reject("Read failed: \(error.localizedDescription)")
            }
        }
    }

    @objc public func isConnected(_ call: CAPPluginCall) {
        workQueue.async {
            call.resolve([
                "connected": self.isConnectionOpen,
            ])
        }
    }

    private var isConnectionOpen: Bool {
        guard let inputStream, let outputStream else {
            return false
        }

        let validStatuses: [Stream.Status] = [.open, .opening, .reading, .writing]
        return validStatuses.contains(inputStream.streamStatus) &&
            validStatuses.contains(outputStream.streamStatus) &&
            inputStream.streamError == nil &&
            outputStream.streamError == nil
    }

    private func openStreams(host: String, port: Int, timeout: TimeInterval) throws {
        var readStream: Unmanaged<CFReadStream>?
        var writeStream: Unmanaged<CFWriteStream>?
        CFStreamCreatePairWithSocketToHost(nil, host as CFString, UInt32(port), &readStream, &writeStream)

        guard let read = readStream?.takeRetainedValue(), let write = writeStream?.takeRetainedValue() else {
            throw NativePluginError.unavailable("Failed to create Telnet socket streams")
        }

        inputStream = read
        outputStream = write
        inputStream?.open()
        outputStream?.open()

        let deadline = Date().addingTimeInterval(timeout)
        while Date() <= deadline {
            if let error = inputStream?.streamError ?? outputStream?.streamError {
                throw error
            }

            let readStatus = inputStream?.streamStatus ?? .notOpen
            let writeStatus = outputStream?.streamStatus ?? .notOpen
            let readyStates: [Stream.Status] = [.open, .reading, .writing]
            if readyStates.contains(readStatus) && readyStates.contains(writeStatus) {
                return
            }

            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
        }

        throw NativePluginError.operationFailed("Telnet connection timed out")
    }

    private func writeAllBytes(_ data: Data, timeout: TimeInterval) throws {
        guard let outputStream else {
            throw NativePluginError.unavailable("Telnet output stream unavailable")
        }

        let bytes = [UInt8](data)
        var offset = 0
        let deadline = Date().addingTimeInterval(timeout)

        while offset < bytes.count {
            if let error = outputStream.streamError {
                throw error
            }
            if Date() > deadline {
                throw NativePluginError.operationFailed("Telnet write timed out")
            }
            if !outputStream.hasSpaceAvailable {
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
                continue
            }

            let written = bytes.withUnsafeBytes { rawBuffer in
                outputStream.write(
                    rawBuffer.baseAddress!.advanced(by: offset).assumingMemoryBound(to: UInt8.self),
                    maxLength: bytes.count - offset
                )
            }

            if written < 0 {
                throw outputStream.streamError ?? NativePluginError.operationFailed("Telnet write failed")
            }
            offset += written
        }
    }

    private func readAvailableBytes(timeout: TimeInterval) throws -> Data {
        guard let inputStream else {
            throw NativePluginError.unavailable("Telnet input stream unavailable")
        }

        var collected = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(timeout)

        while Date() <= deadline {
            if let error = inputStream.streamError {
                throw error
            }

            if inputStream.hasBytesAvailable {
                let readCount = inputStream.read(&buffer, maxLength: buffer.count)
                if readCount < 0 {
                    throw inputStream.streamError ?? NativePluginError.operationFailed("Telnet read failed")
                }
                if readCount == 0 {
                    /*
                     * A stream read of 0 is end of stream, not an empty poll: the peer closed the
                     * connection. Reported as a closure rather than returned as an empty buffer -
                     * see `throwConnectionClosed` (HARD27-013).
                     */
                    try throwConnectionClosed()
                }
                collected.append(buffer, count: readCount)

                if readCount < buffer.count {
                    break
                }
                continue
            }

            if inputStream.streamStatus == .atEnd {
                try throwConnectionClosed()
            }

            if !collected.isEmpty {
                break
            }

            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
        }

        /*
         * Reaching here means the deadline expired with nothing to read, which is an ordinary
         * empty poll and stays an empty result. Only EOF is a closure.
         */
        return collected
    }

    /*
     * The Ultimate drops a Telnet session on its own idle reaping, on a reboot, and when another
     * client takes the last of its four session slots. Android has closed the socket and thrown
     * "Connection closed" on EOF since HARD20-006; iOS returned an empty buffer instead, so
     * `readScreen` counted three empty reads and returned an empty screen while the session still
     * believed it was connected and authenticated. Every later menu action then went into a closed
     * socket and reported a parse failure rather than reconnecting.
     *
     * The message matters: `telnetClient.ts` matches /connection closed/i to raise
     * `CONNECTION_CLOSED`, which is the code `telnetSession.ts` uses to invalidate authentication
     * and reconnect. Any other wording degrades to `DISCONNECTED`, which does not (HARD27-013).
     *
     * Bytes already collected are discarded, as on Android. A session that has gone away cannot
     * answer for a partial screen, and presenting one as a complete read is what produced the
     * parse failures.
     */
    static let connectionClosedMessage = "Connection closed"

    private func throwConnectionClosed() throws -> Never {
        closeStreams()
        throw NativePluginError.operationFailed(Self.connectionClosedMessage)
    }

    private func closeStreams() {
        if let inputStream {
            if inputStream.streamStatus != .closed && inputStream.streamStatus != .notOpen {
                inputStream.close()
            }
            if let error = inputStream.streamError {
                IOSDiagnostics.log(.warn, "Failed to close Telnet input stream", details: ["origin": logOrigin], error: error)
            }
        }

        if let outputStream {
            if outputStream.streamStatus != .closed && outputStream.streamStatus != .notOpen {
                outputStream.close()
            }
            if let error = outputStream.streamError {
                IOSDiagnostics.log(.warn, "Failed to close Telnet output stream", details: ["origin": logOrigin], error: error)
            }
        }

        inputStream = nil
        outputStream = nil
        connectedHost = nil
        connectedPort = nil
    }
}

private enum TelnetRequestValidation {
    static func resolvePort(_ value: Int) -> Result<Int, NativePluginError> {
        guard (1...65_535).contains(value) else {
            return .failure(.invalidArgument("port must be between 1 and 65535"))
        }
        return .success(value)
    }

    static func resolveTimeoutMs(_ value: Int) -> Result<Int, NativePluginError> {
        guard value > 0 else {
            return .failure(.invalidArgument("timeoutMs must be greater than 0"))
        }
        return .success(value)
    }
}
