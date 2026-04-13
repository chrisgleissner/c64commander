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

        workQueue.async {
            do {
                self.closeStreams()
                try self.openStreams(host: host, port: port, timeout: TimeInterval(timeoutMs) / 1000)
                self.connectedHost = host
                self.connectedPort = port
                IOSDiagnostics.log(.info, "Telnet connected", details: [
                    "origin": self.logOrigin,
                    "host": host,
                    "port": port,
                ])
                call.resolve()
            } catch {
                IOSDiagnostics.log(.error, "Telnet connect failed", details: [
                    "origin": self.logOrigin,
                    "host": host,
                    "port": port,
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
                    break
                }
                collected.append(buffer, count: readCount)

                if readCount < buffer.count {
                    break
                }
                continue
            }

            if !collected.isEmpty || inputStream.streamStatus == .atEnd {
                break
            }

            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
        }

        return collected
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
