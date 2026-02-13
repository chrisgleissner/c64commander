/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import Foundation
import Capacitor

@objc(MockC64UPlugin)
public final class MockC64UPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MockC64UPlugin"
    public let jsName = "MockC64U"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopServer", returnType: CAPPluginReturnPromise),
    ]

    private var server: MockC64UServer?
    private var ftpServer: MockFtpServer?

    @objc public func startServer(_ call: CAPPluginCall) {
        guard let config = call.getObject("config") else {
            call.reject("config is required")
            return
        }

        do {
            if let existing = server, existing.isRunning() {
                var payload: [String: Any] = [
                    "port": existing.port,
                    "baseUrl": existing.baseUrl,
                ]
                if let ftp = ftpServer {
                    payload["ftpPort"] = ftp.port
                }
                call.resolve(payload as [String: Any])
                return
            }

            let preferredPort = call.getInt("preferredPort")
            let state = MockC64UState.fromPayload(config)
            let newServer = MockC64UServer(state: state)
            let port = try newServer.start(preferredPort: preferredPort)
            server = newServer

            let ftpRoot = prepareFtpRootDir()
            let networkPassword = state.getNetworkPassword()
            let newFtpServer = MockFtpServer(rootDir: ftpRoot, password: networkPassword)
            let ftpPort = newFtpServer.start()
            ftpServer = newFtpServer

            call.resolve([
                "port": port,
                "baseUrl": newServer.baseUrl,
                "ftpPort": ftpPort,
            ] as [String: Any])
        } catch {
            IOSDiagnostics.log(.error, "MockC64UPlugin: Failed to start server", error: error)
            call.reject(error.localizedDescription)
        }
    }

    @objc public func stopServer(_ call: CAPPluginCall) {
        server?.stop()
        server = nil
        ftpServer?.stop()
        ftpServer = nil
        call.resolve()
    }

    // MARK: - FTP Root Setup

    private func prepareFtpRootDir() -> URL {
        let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        let root = cacheDir.appendingPathComponent("mock-ftp-root")
        let fm = FileManager.default

        if fm.fileExists(atPath: root.path) {
            try? fm.removeItem(at: root)
        }

        createFtpRootStructure(root)
        return root
    }

    private func createFtpRootStructure(_ root: URL) {
        let fm = FileManager.default

        let directories = [
            "Usb0/Music",
            "Usb0/Games/Last Ninja",
            "Usb0/Games/Turrican II",
            "Usb0/Demos/Krestage 3",
        ]

        for dir in directories {
            let dirURL = root.appendingPathComponent(dir)
            try? fm.createDirectory(at: dirURL, withIntermediateDirectories: true)
        }

        let files: [String: Data] = [
            "Usb0/Music/Mock_Tune_0001.sid": createMinimalSidData(),
            "Usb0/Games/Last Ninja/Side A.d64": Data(count: 174848),
            "Usb0/Games/Last Ninja/Side B.d64": Data(count: 174848),
            "Usb0/Games/Turrican II/Disk 1.d64": Data(count: 174848),
            "Usb0/Games/Turrican II/Disk 2.d64": Data(count: 174848),
            "Usb0/Games/Turrican II/Disk 3.d64": Data(count: 174848),
            "Usb0/Demos/Krestage 3/Part 1.d64": Data(count: 174848),
            "Usb0/Demos/Krestage 3/Part 2.d64": Data(count: 174848),
        ]

        for (path, data) in files {
            let fileURL = root.appendingPathComponent(path)
            try? data.write(to: fileURL)
        }
    }

    private func createMinimalSidData() -> Data {
        // Minimal PSID v2 header (0x7C = 124 bytes)
        var data = Data(count: 124)
        // Magic: "PSID"
        data[0] = 0x50; data[1] = 0x53; data[2] = 0x49; data[3] = 0x44
        // Version: 2
        data[4] = 0x00; data[5] = 0x02
        // Data offset: 0x007C (124)
        data[6] = 0x00; data[7] = 0x7C
        // Load address: 0x1000
        data[8] = 0x10; data[9] = 0x00
        // Init address: 0x1000
        data[10] = 0x10; data[11] = 0x00
        // Play address: 0x1003
        data[12] = 0x10; data[13] = 0x03
        // Songs: 1
        data[14] = 0x00; data[15] = 0x01
        // Start song: 1
        data[16] = 0x00; data[17] = 0x01
        // Title at offset 0x16 (22): "Mock Tune"
        let title = Array("Mock Tune".utf8)
        for (i, byte) in title.enumerated() {
            data[0x16 + i] = byte
        }
        return data
    }
}
