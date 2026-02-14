/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import Foundation

final class MockFtpServer {
    private let rootDir: URL
    private let password: String?
    private var serverFD: Int32 = -1
    private(set) var port: Int = 0
    private var running = false
    private var clientFDs: [Int32] = []
    private let lock = NSLock()

    init(rootDir: URL, password: String?) {
        self.rootDir = rootDir
        self.password = password
    }

    func start(preferredPort: Int? = nil) -> Int {
        guard !running else { return port }

        serverFD = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard serverFD >= 0 else {
            IOSDiagnostics.log(.error, "MockFtpServer: Failed to create socket")
            return 0
        }

        var reuse: Int32 = 1
        setsockopt(serverFD, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let resolvedPort = (preferredPort ?? 0) > 1024 ? preferredPort! : 0
        addr.sin_port = UInt16(resolvedPort).bigEndian

        let bindResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.bind(serverFD, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else {
            IOSDiagnostics.log(.error, "MockFtpServer: Failed to bind: errno \(errno)")
            Darwin.close(serverFD)
            serverFD = -1
            return 0
        }

        Darwin.listen(serverFD, 50)

        var boundAddr = sockaddr_in()
        var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &boundAddr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                getsockname(serverFD, sockPtr, &addrLen)
            }
        }
        port = Int(UInt16(bigEndian: boundAddr.sin_port))
        running = true

        DispatchQueue.global().async { [weak self] in
            self?.acceptLoop()
        }

        IOSDiagnostics.log(.info, "MockFtpServer started on port \(port)")
        return port
    }

    func stop() {
        running = false
        if serverFD >= 0 {
            Darwin.close(serverFD)
            serverFD = -1
        }
        lock.lock()
        let fds = clientFDs
        clientFDs.removeAll()
        lock.unlock()
        for fd in fds {
            Darwin.close(fd)
        }
        IOSDiagnostics.log(.info, "MockFtpServer stopped")
    }

    private func acceptLoop() {
        while running {
            var clientAddr = sockaddr_in()
            var clientLen = socklen_t(MemoryLayout<sockaddr_in>.size)
            let clientFD = withUnsafeMutablePointer(to: &clientAddr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                    Darwin.accept(serverFD, sockPtr, &clientLen)
                }
            }
            guard clientFD >= 0 else {
                if !running { break }
                continue
            }
            lock.lock()
            clientFDs.append(clientFD)
            lock.unlock()

            DispatchQueue.global().async { [weak self] in
                guard let self else {
                    Darwin.close(clientFD)
                    return
                }
                self.handleClient(clientFD)
            }
        }
    }

    private func handleClient(_ fd: Int32) {
        defer {
            Darwin.close(fd)
            lock.lock()
            clientFDs.removeAll { $0 == fd }
            lock.unlock()
        }
        let session = MockFtpSession(rootDir: rootDir, password: password, fd: fd)
        session.run()
    }
}

// MARK: - FTP Session

private final class MockFtpSession {
    private let rootDir: URL
    private let password: String?
    private let fd: Int32
    private var cwd = "/"
    private var loggedIn = false
    private var passiveFD: Int32 = -1
    private var closed = false

    init(rootDir: URL, password: String?, fd: Int32) {
        self.rootDir = rootDir
        self.password = password
        self.fd = fd
    }

    func run() {
        sendLine("220 Mock C64U FTP ready")
        while !closed {
            guard let line = readLine() else { break }
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            handleCommand(trimmed)
        }
        cleanupPassive()
    }

    // MARK: - Command Handling

    private func handleCommand(_ rawLine: String) {
        let parts = rawLine.split(separator: " ", maxSplits: 1)
        let command = String(parts[0]).uppercased()
        let argument = parts.count > 1 ? String(parts[1]) : nil

        switch command {
        case "USER":
            sendLine("331 Password required")

        case "PASS":
            if password == nil || password?.isEmpty == true || argument == password {
                loggedIn = true
                sendLine("230 Login ok")
            } else {
                loggedIn = false
                sendLine("530 FTP login failed")
            }

        case "SYST":
            sendLine("215 UNIX Type: L8")

        case "FEAT":
            sendLine("211-Features")
            sendLine("211 End")

        case "TYPE":
            sendLine("200 Type set")

        case "NOOP":
            sendLine("200 OK")

        case "PWD", "XPWD":
            sendLine("257 \"\(cwd)\" is current directory")

        case "CWD":
            guard requireLogin() else { return }
            let next = resolvePath(argument ?? "")
            if isDirectory(next) {
                cwd = next
                sendLine("250 Directory changed")
            } else {
                sendLine("550 Directory not found")
            }

        case "CDUP":
            guard requireLogin() else { return }
            let parent = parentPath(cwd)
            if isDirectory(parent) {
                cwd = parent
                sendLine("250 Directory changed")
            } else {
                sendLine("550 Directory not found")
            }

        case "PASV":
            guard requireLogin() else { return }
            openPassive()

        case "LIST":
            guard requireLogin() else { return }
            let target = argument?.trimmingCharacters(in: .whitespaces).isEmpty == false
                ? resolvePath(argument!) : cwd
            sendLine("150 Opening data connection")
            if let dataFD = acceptDataConnection() {
                writeListing(to: dataFD, path: target, namesOnly: false)
                Darwin.close(dataFD)
            }
            sendLine("226 Transfer complete")

        case "NLST":
            guard requireLogin() else { return }
            let target = argument?.trimmingCharacters(in: .whitespaces).isEmpty == false
                ? resolvePath(argument!) : cwd
            sendLine("150 Opening data connection")
            if let dataFD = acceptDataConnection() {
                writeListing(to: dataFD, path: target, namesOnly: true)
                Darwin.close(dataFD)
            }
            sendLine("226 Transfer complete")

        case "RETR":
            guard requireLogin() else { return }
            guard let path = argument?.trimmingCharacters(in: .whitespaces), !path.isEmpty else {
                sendLine("550 File not found")
                return
            }
            let resolved = resolvePath(path)
            guard let fileURL = resolveFile(resolved),
                  FileManager.default.isReadableFile(atPath: fileURL.path),
                  !isDirectoryURL(fileURL) else {
                sendLine("550 File not found")
                return
            }
            sendLine("150 Opening data connection")
            if let dataFD = acceptDataConnection() {
                sendFileData(from: fileURL, to: dataFD)
                Darwin.close(dataFD)
            }
            sendLine("226 Transfer complete")

        case "QUIT":
            sendLine("221 Goodbye")
            closed = true

        default:
            sendLine("502 Command not implemented")
        }
    }

    // MARK: - I/O Helpers

    private func sendLine(_ message: String) {
        writeAll(fd, Array("\(message)\r\n".utf8))
    }

    private func readLine() -> String? {
        var buffer: [UInt8] = []
        var byte: UInt8 = 0
        while true {
            let n = Darwin.read(fd, &byte, 1)
            if n <= 0 { return buffer.isEmpty ? nil : String(bytes: buffer, encoding: .utf8) }
            if byte == 0x0A { break }
            if byte != 0x0D { buffer.append(byte) }
        }
        return buffer.isEmpty ? nil : String(bytes: buffer, encoding: .utf8)
    }

    private func writeAll(_ targetFD: Int32, _ data: [UInt8]) {
        data.withUnsafeBufferPointer { buffer in
            guard let ptr = buffer.baseAddress else { return }
            var offset = 0
            while offset < data.count {
                let n = Darwin.write(targetFD, ptr + offset, data.count - offset)
                if n <= 0 { return }
                offset += n
            }
        }
    }

    // MARK: - PASV Data Connection

    private func openPassive() {
        cleanupPassive()

        let dataServerFD = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard dataServerFD >= 0 else {
            sendLine("425 Cannot create data socket")
            return
        }

        var reuse: Int32 = 1
        setsockopt(dataServerFD, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        addr.sin_port = 0

        let bindResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.bind(dataServerFD, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else {
            Darwin.close(dataServerFD)
            sendLine("425 Cannot bind data socket")
            return
        }

        Darwin.listen(dataServerFD, 1)

        var boundAddr = sockaddr_in()
        var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &boundAddr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                getsockname(dataServerFD, sockPtr, &addrLen)
            }
        }
        let dataPort = Int(UInt16(bigEndian: boundAddr.sin_port))
        passiveFD = dataServerFD

        let p1 = dataPort / 256
        let p2 = dataPort % 256
        sendLine("227 Entering Passive Mode (127,0,0,1,\(p1),\(p2))")
    }

    private func acceptDataConnection() -> Int32? {
        guard passiveFD >= 0 else {
            sendLine("425 Use PASV first")
            return nil
        }
        var clientAddr = sockaddr_in()
        var clientLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        let dataFD = withUnsafeMutablePointer(to: &clientAddr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.accept(passiveFD, sockPtr, &clientLen)
            }
        }
        cleanupPassive()
        return dataFD >= 0 ? dataFD : nil
    }

    private func cleanupPassive() {
        if passiveFD >= 0 {
            Darwin.close(passiveFD)
            passiveFD = -1
        }
    }

    // MARK: - Directory Listing

    private func writeListing(to dataFD: Int32, path: String, namesOnly: Bool) {
        guard let dirURL = resolveFile(path) else { return }
        let fm = FileManager.default

        guard let entries = try? fm.contentsOfDirectory(
            at: dirURL,
            includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey]
        ) else { return }

        let formatter = DateFormatter()
        formatter.dateFormat = "MMM dd HH:mm"
        formatter.locale = Locale(identifier: "en_US_POSIX")

        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let name = entry.lastPathComponent
            if namesOnly {
                writeAll(dataFD, Array("\(name)\r\n".utf8))
            } else {
                let isDir = (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                let size = isDir ? 0 : ((try? entry.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
                let date = (try? entry.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date()
                let perms = isDir ? "drwxr-xr-x" : "-rw-r--r--"
                let dateStr = formatter.string(from: date)
                let line = "\(perms) 1 user group \(size) \(dateStr) \(name)\r\n"
                writeAll(dataFD, Array(line.utf8))
            }
        }
    }

    private func sendFileData(from fileURL: URL, to dataFD: Int32) {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        data.withUnsafeBytes { buffer in
            guard let ptr = buffer.baseAddress else { return }
            var offset = 0
            while offset < data.count {
                let n = Darwin.write(dataFD, ptr + offset, data.count - offset)
                if n <= 0 { return }
                offset += n
            }
        }
    }

    // MARK: - Path Resolution

    private func resolvePath(_ raw: String) -> String {
        let base = raw.hasPrefix("/") ? raw : (cwd.hasSuffix("/") ? "\(cwd)\(raw)" : "\(cwd)/\(raw)")
        let parts = base.split(separator: "/").filter { $0 != "." }
        var normalized: [String] = []
        for part in parts {
            if part == ".." {
                if !normalized.isEmpty { normalized.removeLast() }
            } else {
                normalized.append(String(part))
            }
        }
        return normalized.isEmpty ? "/" : "/" + normalized.joined(separator: "/")
    }

    private func parentPath(_ path: String) -> String {
        if path == "/" { return "/" }
        let trimmed = path.hasSuffix("/") ? String(path.dropLast()) : path
        guard let idx = trimmed.lastIndex(of: "/"), idx != trimmed.startIndex else { return "/" }
        return String(trimmed[trimmed.startIndex..<idx])
    }

    private func resolveFile(_ path: String) -> URL? {
        let normalized = resolvePath(path)
        let relative = String(normalized.dropFirst())
        let target: URL
        if relative.isEmpty {
            target = rootDir
        } else {
            target = rootDir.appendingPathComponent(relative)
        }
        let canonicalRoot = (rootDir.path as NSString).standardizingPath
        let canonicalTarget = (target.path as NSString).standardizingPath
        guard canonicalTarget == canonicalRoot || canonicalTarget.hasPrefix(canonicalRoot + "/") else {
            return nil
        }
        return target
    }

    private func isDirectory(_ path: String) -> Bool {
        guard let url = resolveFile(path) else { return false }
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && isDir.boolValue
    }

    private func isDirectoryURL(_ url: URL) -> Bool {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && isDir.boolValue
    }

    private func requireLogin() -> Bool {
        if !loggedIn {
            sendLine("530 Not logged in")
            return false
        }
        return true
    }
}
