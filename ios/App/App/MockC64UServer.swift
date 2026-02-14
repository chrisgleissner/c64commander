/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import Foundation
import Network

struct MockHttpRequest {
    let method: String
    let path: String
    let queryParams: [String: String]
    let headers: [String: String]
    let body: Data
}

struct MockHttpResponse {
    let status: Int
    let headers: [String: String]
    let body: Data
}

final class MockC64UServer {
    private let state: MockC64UState
    private let queue = DispatchQueue(label: "uk.gleissner.c64commander.mockc64userver")
    private var listener: NWListener?
    private var connections: [NWConnection] = []
    private(set) var port: Int = 0
    private(set) var running = false

    var baseUrl: String { "http://127.0.0.1:\(port)" }

    init(state: MockC64UState) {
        self.state = state
    }

    func start(preferredPort: Int? = nil) throws -> Int {
        guard !running else { return port }

        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        if let ipOptions = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ipOptions.version = .v4
        }

        let nwPort: NWEndpoint.Port
        if let preferred = preferredPort, preferred > 1024,
           let p = NWEndpoint.Port(rawValue: UInt16(preferred)) {
            nwPort = p
        } else {
            nwPort = .any
        }

        let newListener = try NWListener(using: parameters, on: nwPort)

        let semaphore = DispatchSemaphore(value: 0)
        var startError: Error?

        newListener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                semaphore.signal()
            case .failed(let error):
                startError = error
                semaphore.signal()
            default:
                break
            }
        }

        newListener.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        newListener.start(queue: queue)
        semaphore.wait()

        if let error = startError {
            throw error
        }

        port = Int(newListener.port?.rawValue ?? 0)
        listener = newListener
        running = true
        IOSDiagnostics.log(.info, "MockC64UServer started on port \(port)")
        return port
    }

    func stop() {
        running = false
        listener?.cancel()
        listener = nil
        queue.sync {
            for connection in connections {
                connection.cancel()
            }
            connections.removeAll()
        }
        IOSDiagnostics.log(.info, "MockC64UServer stopped")
    }

    func isRunning() -> Bool { running }

    // MARK: - Connection Handling

    private func handleConnection(_ connection: NWConnection) {
        queue.async { self.connections.append(connection) }
        connection.start(queue: queue)
        receiveRequest(connection: connection, accumulated: Data())
    }

    private func receiveRequest(connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            if let error {
                IOSDiagnostics.log(.warn, "MockC64UServer receive error", error: error)
                self.removeConnection(connection)
                return
            }

            var allData = accumulated
            if let data {
                allData.append(data)
            }

            let separator = Data([0x0D, 0x0A, 0x0D, 0x0A])
            guard allData.range(of: separator) != nil else {
                if isComplete {
                    self.removeConnection(connection)
                } else {
                    self.receiveRequest(connection: connection, accumulated: allData)
                }
                return
            }

            guard let request = self.parseRequest(allData) else {
                self.sendResponse(connection: connection, response: self.errorResponse(400, "Bad request"))
                return
            }

            let contentLength = Int(request.headers["content-length"] ?? "0") ?? 0
            if contentLength > request.body.count && !isComplete {
                self.receiveRemainingBody(connection: connection, request: request, expectedLength: contentLength)
            } else {
                let response = self.handleRequest(request)
                self.sendResponse(connection: connection, response: response)
            }
        }
    }

    private func receiveRemainingBody(connection: NWConnection, request: MockHttpRequest, expectedLength: Int) {
        let remaining = expectedLength - request.body.count
        connection.receive(minimumIncompleteLength: remaining, maximumLength: remaining) { [weak self] data, _, _, error in
            guard let self else {
                connection.cancel()
                return
            }
            if let error {
                IOSDiagnostics.log(.warn, "MockC64UServer body receive error", error: error)
                self.removeConnection(connection)
                return
            }
            var fullBody = request.body
            if let data { fullBody.append(data) }
            let fullRequest = MockHttpRequest(
                method: request.method, path: request.path,
                queryParams: request.queryParams, headers: request.headers,
                body: fullBody
            )
            let response = self.handleRequest(fullRequest)
            self.sendResponse(connection: connection, response: response)
        }
    }

    private func removeConnection(_ connection: NWConnection) {
        connection.cancel()
        queue.async {
            self.connections.removeAll { $0 === connection }
        }
    }

    private func sendResponse(connection: NWConnection, response: MockHttpResponse) {
        let responseData = buildResponseData(response)
        connection.send(content: responseData, completion: .contentProcessed { [weak self] error in
            if let error {
                IOSDiagnostics.log(.warn, "MockC64UServer send error", error: error)
            }
            self?.removeConnection(connection)
        })
    }

    private func buildResponseData(_ response: MockHttpResponse) -> Data {
        let statusText: String
        switch response.status {
        case 200: statusText = "OK"
        case 204: statusText = "No Content"
        case 400: statusText = "Bad Request"
        case 404: statusText = "Not Found"
        default: statusText = "Internal Server Error"
        }

        var headers: [String: String] = [
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Password, X-C64U-Host",
            "Connection": "close",
            "Content-Length": "\(response.body.count)",
        ]
        for (key, value) in response.headers {
            headers[key] = value
        }

        var raw = "HTTP/1.1 \(response.status) \(statusText)\r\n"
        for (name, value) in headers {
            raw += "\(name): \(value)\r\n"
        }
        raw += "\r\n"
        var data = Data(raw.utf8)
        data.append(response.body)
        return data
    }

    // MARK: - Request Parsing

    private func parseRequest(_ data: Data) -> MockHttpRequest? {
        let separator = Data([0x0D, 0x0A, 0x0D, 0x0A])
        guard let separatorRange = data.range(of: separator) else { return nil }

        let headerData = data[data.startIndex..<separatorRange.lowerBound]
        let bodyData = Data(data[separatorRange.upperBound...])

        guard let headerString = String(data: headerData, encoding: .utf8) else { return nil }
        let lines = headerString.components(separatedBy: "\r\n")
        guard !lines.isEmpty, !lines[0].isEmpty else { return nil }

        let requestLineParts = lines[0].split(separator: " ", maxSplits: 2)
        guard requestLineParts.count >= 2 else { return nil }

        let method = String(requestLineParts[0]).uppercased()
        let target = String(requestLineParts[1])

        let path: String
        let queryString: String
        if let qIdx = target.firstIndex(of: "?") {
            path = String(target[target.startIndex..<qIdx])
            queryString = String(target[target.index(after: qIdx)...])
        } else {
            path = target
            queryString = ""
        }

        var headers: [String: String] = [:]
        for i in 1..<lines.count {
            let line = lines[i]
            if line.isEmpty { break }
            if let colonIdx = line.firstIndex(of: ":") {
                let name = String(line[line.startIndex..<colonIdx]).trimmingCharacters(in: .whitespaces).lowercased()
                let value = String(line[line.index(after: colonIdx)...]).trimmingCharacters(in: .whitespaces)
                headers[name] = value
            }
        }

        return MockHttpRequest(method: method, path: path, queryParams: parseQuery(queryString), headers: headers, body: bodyData)
    }

    private func parseQuery(_ query: String) -> [String: String] {
        guard !query.isEmpty else { return [:] }
        var result: [String: String] = [:]
        for part in query.split(separator: "&") {
            let pair = part.split(separator: "=", maxSplits: 1)
            guard let key = pair.first else { continue }
            let keyStr = String(key).removingPercentEncoding ?? String(key)
            let valueStr = pair.count > 1 ? (String(pair[1]).removingPercentEncoding ?? String(pair[1])) : ""
            if !keyStr.isEmpty { result[keyStr] = valueStr }
        }
        return result
    }

    // MARK: - Request Routing

    private func handleRequest(_ request: MockHttpRequest) -> MockHttpResponse {
        if request.method == "OPTIONS" {
            return MockHttpResponse(status: 204, headers: [:], body: Data())
        }

        let path = request.path

        if request.method == "GET" && path == "/v1/version" {
            return jsonResponse(200, [
                "version": state.general.restApiVersion,
                "errors": [] as [Any],
            ])
        }

        if request.method == "GET" && path == "/v1/info" {
            return jsonResponse(200, [
                "product": state.general.deviceType,
                "firmware_version": state.general.firmwareVersion,
                "fpga_version": state.general.fpgaVersion,
                "core_version": state.general.coreVersion,
                "hostname": state.general.hostname,
                "unique_id": state.general.uniqueId,
                "errors": [] as [Any],
            ])
        }

        let runnerPaths: Set<String> = [
            "/v1/runners:sidplay", "/v1/runners:modplay",
            "/v1/runners:load_prg", "/v1/runners:run_prg", "/v1/runners:run_crt",
        ]
        if runnerPaths.contains(path) && (request.method == "PUT" || request.method == "POST") {
            if request.method == "PUT" && request.queryParams["file"] == nil {
                return errorResponse(400, "Missing file")
            }
            return okResponse()
        }

        if path.hasPrefix("/v1/configs") {
            return routeConfigs(request)
        }

        let machineActions: Set<String> = [
            "/v1/machine:reset", "/v1/machine:reboot", "/v1/machine:pause",
            "/v1/machine:resume", "/v1/machine:poweroff", "/v1/machine:menu_button",
        ]
        if request.method == "PUT" && machineActions.contains(path) {
            if ["/v1/machine:reset", "/v1/machine:reboot", "/v1/machine:poweroff"].contains(path) {
                state.resetKeyboardBuffer()
            }
            return okResponse()
        }

        if path == "/v1/machine:writemem" && (request.method == "PUT" || request.method == "POST") {
            guard let address = parseHex(request.queryParams["address"]) else {
                return errorResponse(400, "Missing address")
            }
            let bytes: [Int]
            if request.method == "PUT" {
                guard let data = request.queryParams["data"], let parsed = parseHexBytes(data) else {
                    return errorResponse(400, "Missing or invalid data")
                }
                bytes = parsed
            } else {
                bytes = request.body.map { Int($0) }
            }
            for (idx, value) in bytes.enumerated() {
                state.memory[address + idx] = value
            }
            return okResponse()
        }

        if path == "/v1/machine:readmem" && request.method == "GET" {
            guard let address = parseHex(request.queryParams["address"]) else {
                return errorResponse(400, "Missing address")
            }
            let length = min(max(Int(request.queryParams["length"] ?? "256") ?? 256, 1), 4096)
            var data: [Int] = []
            for offset in 0..<length {
                data.append(state.memory[address + offset] ?? 0)
            }
            return jsonResponse(200, ["data": data, "errors": [] as [Any]])
        }

        if path == "/v1/machine:debugreg" {
            if request.method == "GET" {
                return jsonResponse(200, ["value": state.debugRegister, "errors": [] as [Any]])
            }
            if request.method == "PUT" {
                guard let value = request.queryParams["value"] else {
                    return errorResponse(400, "Missing value")
                }
                state.debugRegister = value
                return jsonResponse(200, ["value": state.debugRegister, "errors": [] as [Any]])
            }
        }

        if path == "/v1/drives" && request.method == "GET" {
            return jsonResponse(200, buildDrivesPayload())
        }

        if path.hasPrefix("/v1/drives/") && (request.method == "PUT" || request.method == "POST") {
            return routeDriveAction(request)
        }

        if path.hasPrefix("/v1/streams/") && request.method == "PUT" {
            let rest = String(path.dropFirst("/v1/streams/".count))
            if rest.hasSuffix(":start") && request.queryParams["ip"] == nil {
                return errorResponse(400, "Missing ip")
            }
            if rest.hasSuffix(":start") || rest.hasSuffix(":stop") {
                return okResponse()
            }
        }

        if path.hasPrefix("/v1/files/") {
            return routeFiles(request)
        }

        return errorResponse(404, "Not found")
    }

    // MARK: - Config Routes

    private func routeConfigs(_ request: MockHttpRequest) -> MockHttpResponse {
        let path = request.path

        if path == "/v1/configs" && request.method == "GET" {
            return jsonResponse(200, ["categories": state.listCategories(), "errors": [] as [Any]])
        }

        if path == "/v1/configs" && request.method == "POST" {
            if !request.body.isEmpty {
                if let json = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any] {
                    state.updateConfigBatch(json)
                } else {
                    return errorResponse(400, "Invalid JSON payload")
                }
            }
            return okResponse()
        }

        if request.method == "PUT" && (path == "/v1/configs:load_from_flash" || path == "/v1/configs:save_to_flash") {
            return okResponse()
        }
        if request.method == "PUT" && path == "/v1/configs:reset_to_default" {
            state.resetConfig()
            return okResponse()
        }

        guard path.hasPrefix("/v1/configs/") else {
            return errorResponse(404, "Not found")
        }

        let rest = String(path.dropFirst("/v1/configs/".count))
        let segments = rest.split(separator: "/", maxSplits: 1)

        if segments.count == 1 && request.method == "GET" {
            let rawCategory = String(segments[0]).removingPercentEncoding ?? String(segments[0])
            let matched = resolveCategories(rawCategory)
            if matched.isEmpty { return errorResponse(404, "Category not found") }
            var payload: [String: Any] = [:]
            for categoryName in matched {
                let items = state.getCategory(categoryName) ?? [:]
                payload[categoryName] = buildCategoryPayload(items)
            }
            payload["errors"] = [] as [Any]
            return jsonResponse(200, payload)
        }

        if segments.count == 2 {
            let category = String(segments[0]).removingPercentEncoding ?? String(segments[0])
            let item = String(segments[1]).removingPercentEncoding ?? String(segments[1])

            if request.method == "PUT" {
                guard let value = request.queryParams["value"] else {
                    return errorResponse(400, "Missing value")
                }
                state.updateConfigValue(category: category, item: item, value: value)
                return okResponse()
            }
            if request.method == "GET" {
                guard let items = state.getCategory(category) else {
                    return errorResponse(404, "Category not found")
                }
                guard let entry = items[item] else {
                    return errorResponse(404, "Item not found")
                }
                var payload: [String: Any] = [:]
                payload[category] = buildCategoryPayload([item: entry])
                payload["errors"] = [] as [Any]
                return jsonResponse(200, payload)
            }
        }

        return errorResponse(404, "Not found")
    }

    // MARK: - Drive Routes

    private func routeDriveAction(_ request: MockHttpRequest) -> MockHttpResponse {
        let rest = String(request.path.dropFirst("/v1/drives/".count))
        guard let colonIdx = rest.firstIndex(of: ":") else {
            return errorResponse(404, "Not found")
        }
        let driveKey = (String(rest[rest.startIndex..<colonIdx]).removingPercentEncoding ?? "").lowercased()
        let action = String(rest[rest.index(after: colonIdx)...])

        guard var drive = state.drives[driveKey] else {
            return errorResponse(404, "Drive not found")
        }

        switch action {
        case "mount":
            let image: String
            if request.method == "PUT" {
                guard let img = request.queryParams["image"] else {
                    return errorResponse(400, "Missing image")
                }
                image = img
            } else {
                image = request.queryParams["image"] ?? "upload-\(Int(Date().timeIntervalSince1970 * 1000))"
            }
            drive.imageFile = image.components(separatedBy: "/").last
            let imagePath = image.components(separatedBy: "/").dropLast().joined(separator: "/")
            drive.imagePath = imagePath.isEmpty ? nil : imagePath
            state.drives[driveKey] = drive
            return okResponse()

        case "reset":
            return okResponse()

        case "remove":
            drive.imageFile = nil
            drive.imagePath = nil
            state.drives[driveKey] = drive
            return okResponse()

        case "on":
            drive.enabled = true
            state.drives[driveKey] = drive
            return okResponse()

        case "off":
            drive.enabled = false
            state.drives[driveKey] = drive
            return okResponse()

        case "load_rom":
            let file: String
            if request.method == "PUT" {
                guard let f = request.queryParams["file"] else {
                    return errorResponse(400, "Missing file")
                }
                file = f
            } else {
                file = request.queryParams["file"] ?? "upload-\(Int(Date().timeIntervalSince1970 * 1000)).rom"
            }
            drive.rom = file.components(separatedBy: "/").last
            state.drives[driveKey] = drive
            return okResponse()

        case "set_mode":
            guard let mode = request.queryParams["mode"] else {
                return errorResponse(400, "Missing mode")
            }
            drive.type = mode
            drive.rom = resolveDriveRom(driveKey: driveKey, mode: mode) ?? drive.rom
            state.drives[driveKey] = drive
            return okResponse()

        default:
            return errorResponse(404, "Not found")
        }
    }

    // MARK: - File Routes

    private func routeFiles(_ request: MockHttpRequest) -> MockHttpResponse {
        let rest = String(request.path.dropFirst("/v1/files/".count))

        if rest.hasSuffix(":info") && request.method == "GET" {
            let filePath = (String(rest.dropLast(":info".count)).removingPercentEncoding ?? "")
            let normalized = filePath.hasPrefix("/") ? filePath : "/\(filePath)"
            let filename = filePath.components(separatedBy: "/").last ?? filePath
            let ext = filename.components(separatedBy: ".").last?.uppercased() ?? ""
            return jsonResponse(200, [
                "files": [
                    "path": normalized,
                    "filename": filename,
                    "size": 0,
                    "extension": ext,
                ] as [String: Any],
                "errors": [] as [Any],
            ])
        }

        let createSuffixes = [":create_d64", ":create_d71", ":create_d81", ":create_dnp"]
        for suffix in createSuffixes {
            if rest.hasSuffix(suffix) && request.method == "PUT" {
                if suffix == ":create_dnp" && request.queryParams["tracks"] == nil {
                    return errorResponse(400, "Missing tracks")
                }
                return okResponse()
            }
        }

        return errorResponse(404, "Not found")
    }

    // MARK: - Helpers

    private func resolveCategories(_ rawCategory: String) -> [String] {
        if rawCategory.contains("*") {
            let escaped = NSRegularExpression.escapedPattern(for: rawCategory)
                .replacingOccurrences(of: "\\*", with: ".*")
            guard let regex = try? NSRegularExpression(pattern: "^\(escaped)$") else { return [] }
            return state.listCategories().filter { name in
                regex.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
            }
        }
        return state.getCategory(rawCategory) != nil ? [rawCategory] : []
    }

    private func resolveDriveRom(driveKey: String, mode: String) -> String? {
        let category = driveKey == "a" ? "Drive A Settings" : "Drive B Settings"
        guard let items = state.getCategory(category) else { return nil }
        let key: String
        switch mode {
        case "1571": key = "ROM for 1571 mode"
        case "1581": key = "ROM for 1581 mode"
        default: key = "ROM for 1541 mode"
        }
        return items[key]?.value as? String
    }

    private func parseHex(_ value: String?) -> Int? {
        guard let value, !value.isEmpty else { return nil }
        let cleaned = value.trimmingCharacters(in: .whitespaces).lowercased()
            .replacingOccurrences(of: "0x", with: "")
            .replacingOccurrences(of: "$", with: "")
        return Int(cleaned, radix: 16)
    }

    private func parseHexBytes(_ value: String) -> [Int]? {
        let cleaned = value.replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)
        guard cleaned.count % 2 == 0 else { return nil }
        var bytes: [Int] = []
        var index = cleaned.startIndex
        while index < cleaned.endIndex {
            let next = cleaned.index(index, offsetBy: 2)
            guard let parsed = Int(String(cleaned[index..<next]), radix: 16) else { return nil }
            bytes.append(parsed)
            index = next
        }
        return bytes
    }

    private func buildDrivesPayload() -> [String: Any] {
        var drivesArray: [[String: Any]] = []
        for (key, drive) in state.drives.sorted(by: { $0.key < $1.key }) {
            var info: [String: Any] = [
                "enabled": drive.enabled,
                "bus_id": drive.busId,
                "type": drive.type,
            ]
            if let rom = drive.rom { info["rom"] = rom }
            if let imageFile = drive.imageFile { info["image_file"] = imageFile }
            if let imagePath = drive.imagePath { info["image_path"] = imagePath }
            if let lastError = drive.lastError { info["last_error"] = lastError }
            if let partitions = drive.partitions {
                info["partitions"] = partitions.map { ["id": $0.id, "path": $0.path] as [String: Any] }
            }
            drivesArray.append([key: info])
        }
        return ["drives": drivesArray, "errors": [] as [Any]]
    }

    private func buildCategoryPayload(_ items: [String: MockConfigItem]) -> [String: Any] {
        var itemsDict: [String: Any] = [:]
        for (name, item) in items {
            itemsDict[name] = buildConfigItem(item)
        }
        return ["items": itemsDict]
    }

    private func buildConfigItem(_ item: MockConfigItem) -> [String: Any] {
        var payload: [String: Any] = ["selected": item.value]
        if let options = item.options { payload["options"] = options }
        if let details = item.details {
            var detailsDict: [String: Any] = [:]
            if let min = details.min { detailsDict["min"] = min }
            if let max = details.max { detailsDict["max"] = max }
            if let format = details.format { detailsDict["format"] = format }
            if let presets = details.presets { detailsDict["presets"] = presets }
            payload["details"] = detailsDict
        }
        return payload
    }

    private func okResponse() -> MockHttpResponse {
        jsonResponse(200, ["errors": [] as [Any]])
    }

    private func errorResponse(_ status: Int, _ message: String) -> MockHttpResponse {
        jsonResponse(status, ["errors": [message]])
    }

    private func jsonResponse(_ status: Int, _ payload: [String: Any]) -> MockHttpResponse {
        let body: Data
        do {
            body = try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            IOSDiagnostics.log(.error, "MockC64UServer: Failed to serialize JSON", error: error)
            body = Data("{\"errors\":[\"Serialization error\"]}".utf8)
        }
        return MockHttpResponse(status: status, headers: ["Content-Type": "application/json"], body: body)
    }
}
