import Foundation

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
    private let timeout: TimeInterval = 30

    private var inputStream: InputStream?
    private var outputStream: OutputStream?

    init(host: String, port: Int) {
        self.host = host
        self.port = port
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

        _ = try readResponse(expectPrefix: [220])
    }

    func disconnect() {
        inputStream?.close()
        outputStream?.close()
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
        _ = try sendAndRead("PASV", expected: [227])
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
        let dataSession = FtpSession(host: passiveAddress.host, port: passiveAddress.port)
        try dataSession.connectForData()

        _ = try sendAndRead("RETR \(path)", expectedPrefix: [125, 150])
        let bytes = try dataSession.readAllBytes()
        dataSession.disconnect()
        _ = try readResponse(expectPrefix: [226, 250])
        return Data(bytes)
    }

    private func listDirectory(path: String, command: String) throws -> [FtpEntry] {
        let passiveAddress = try openPassiveDataChannel()
        let dataSession = FtpSession(host: passiveAddress.host, port: passiveAddress.port)
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

    private func readResponse(expect: [Int]? = nil, expectPrefix: [Int]? = nil) throws -> (code: Int, message: String) {
        var lines: [String] = []
        var responseCode: Int?
        var multilineCode: Int?
        let deadline = Date().addingTimeInterval(timeout)

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

        if let expected, !expected.contains(code) {
            throw NativePluginError.operationFailed("FTP command failed (\(code))")
        }
        if let expectedPrefix, !expectedPrefix.contains(code) {
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
        let deadline = Date().addingTimeInterval(timeout)

        while Date() <= deadline {
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
        }

        return bytes
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
