/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import Foundation

struct MockConfigDetails {
    var min: NSNumber?
    var max: NSNumber?
    var format: String?
    var presets: [String]?
}

struct MockConfigItem {
    var value: Any
    var options: [String]?
    var details: MockConfigDetails?
}

struct MockGeneralInfo {
    let restApiVersion: String
    let deviceType: String
    let firmwareVersion: String
    let baseUrl: String
    let hostname: String
    let uniqueId: String
    let fpgaVersion: String
    let coreVersion: String
}

struct DrivePartition {
    let id: Int
    let path: String
}

struct DriveState {
    var enabled: Bool
    var busId: Int
    var type: String
    var rom: String?
    var imageFile: String?
    var imagePath: String?
    var lastError: String?
    var partitions: [DrivePartition]?
}

final class MockC64UState {
    let general: MockGeneralInfo
    private let defaults: [String: [String: MockConfigItem]]
    private(set) var config: [String: [String: MockConfigItem]]
    var drives: [String: DriveState]
    var debugRegister: String = "00"
    var memory: [Int: Int] = [:]

    private init(general: MockGeneralInfo, defaults: [String: [String: MockConfigItem]]) {
        self.general = general
        self.defaults = defaults
        self.config = Self.cloneConfig(defaults)
        self.drives = [:]
        self.drives = buildDriveState()
    }

    func resetKeyboardBuffer() {
        let bufferStart = 0x0277
        memory[0x00C6] = 0
        for offset in 0..<10 {
            memory[bufferStart + offset] = 0
        }
    }

    static func fromPayload(_ payload: [String: Any]) -> MockC64UState {
        let generalObj = payload["general"] as? [String: Any] ?? [:]
        let baseUrl = nonEmpty(generalObj["baseUrl"]) ?? "http://c64u"
        let hostname: String
        if let url = URL(string: baseUrl), let host = url.host {
            hostname = host
        } else {
            IOSDiagnostics.log(.warn, "Failed to parse mock base URL: \(baseUrl)")
            hostname = "c64u"
        }
        let general = MockGeneralInfo(
            restApiVersion: nonEmpty(generalObj["restApiVersion"]) ?? "0.1",
            deviceType: nonEmpty(generalObj["deviceType"]) ?? "Ultimate 64",
            firmwareVersion: nonEmpty(generalObj["firmwareVersion"]) ?? "3.12a",
            baseUrl: baseUrl,
            hostname: hostname,
            uniqueId: "MOCK-\(hostname.uppercased())",
            fpgaVersion: nonEmpty(generalObj["fpgaVersion"]) ?? "mock",
            coreVersion: nonEmpty(generalObj["coreVersion"]) ?? "mock"
        )

        let categoriesObj = payload["categories"] as? [String: Any] ?? [:]
        var categories: [String: [String: MockConfigItem]] = [:]
        for (categoryName, itemsRaw) in categoriesObj {
            guard let itemsObj = itemsRaw as? [String: Any] else { continue }
            var items: [String: MockConfigItem] = [:]
            for (itemName, itemRaw) in itemsObj {
                guard let itemObj = itemRaw as? [String: Any] else { continue }
                let value = unwrap(itemObj["value"]) ?? ""
                let options = (itemObj["options"] as? [Any])?.compactMap { unwrap($0).map { "\($0)" } }
                let details = (itemObj["details"] as? [String: Any]).flatMap { parseDetails($0) }
                items[itemName] = MockConfigItem(value: value, options: options, details: details)
            }
            categories[categoryName] = items
        }

        return MockC64UState(general: general, defaults: categories)
    }

    // MARK: - Config Access

    func listCategories() -> [String] { config.keys.sorted() }

    func getCategory(_ category: String) -> [String: MockConfigItem]? { config[category] }

    func updateConfigValue(category: String, item: String, value: Any) {
        if config[category] == nil { config[category] = [:] }
        if var existing = config[category]?[item] {
            existing.value = value
            config[category]?[item] = existing
        } else {
            config[category]?[item] = MockConfigItem(value: value, options: nil, details: nil)
        }
        refreshDriveState(category: category)
    }

    func updateConfigBatch(_ payload: [String: Any]) {
        for (categoryName, itemsRaw) in payload {
            guard let itemsObj = itemsRaw as? [String: Any] else { continue }
            for (itemName, valueRaw) in itemsObj {
                updateConfigValue(category: categoryName, item: itemName, value: Self.unwrap(valueRaw) ?? "")
            }
        }
    }

    func resetConfig() {
        config = Self.cloneConfig(defaults)
        refreshDriveState()
    }

    func getNetworkPassword() -> String? {
        (config["Network Settings"]?["Network Password"]?.value as? String) ?? ""
    }

    // MARK: - Drive State

    private func refreshDriveState(category: String? = nil) {
        let targets: [String]
        switch category {
        case "Drive A Settings": targets = ["a"]
        case "Drive B Settings": targets = ["b"]
        default: targets = ["a", "b"]
        }
        for key in targets {
            let catName = key == "a" ? "Drive A Settings" : "Drive B Settings"
            drives[key] = buildDriveStateFor(driveKey: key, items: config[catName], existing: drives[key])
        }
    }

    private func buildDriveState() -> [String: DriveState] {
        [
            "a": buildDriveStateFor(driveKey: "a", items: config["Drive A Settings"], existing: nil),
            "b": buildDriveStateFor(driveKey: "b", items: config["Drive B Settings"], existing: nil),
        ]
    }

    private func buildDriveStateFor(driveKey: String, items: [String: MockConfigItem]?, existing: DriveState?) -> DriveState {
        let enabled = (items?["Drive"]?.value as? String)?.caseInsensitiveCompare("Enabled") == .orderedSame
        let busId = Self.parseInt(items?["Drive Bus ID"]?.value, fallback: driveKey == "a" ? 8 : 9)
        let type = (items?["Drive Type"]?.value as? String) ?? existing?.type ?? "1541"
        let rom = resolveRom(type: type, items: items) ?? existing?.rom
        return DriveState(
            enabled: enabled, busId: busId, type: type, rom: rom,
            imageFile: existing?.imageFile, imagePath: existing?.imagePath,
            lastError: existing?.lastError, partitions: existing?.partitions
        )
    }

    private func resolveRom(type: String, items: [String: MockConfigItem]?) -> String? {
        let key: String
        switch type {
        case "1571": key = "ROM for 1571 mode"
        case "1581": key = "ROM for 1581 mode"
        default: key = "ROM for 1541 mode"
        }
        return items?[key]?.value as? String
    }

    // MARK: - Helpers

    private static func nonEmpty(_ value: Any?) -> String? {
        guard let str = value as? String, !str.isEmpty else { return nil }
        return str
    }

    private static func unwrap(_ value: Any?) -> Any? {
        if value is NSNull { return nil }
        return value
    }

    private static func parseDetails(_ obj: [String: Any]) -> MockConfigDetails {
        MockConfigDetails(
            min: parseNumber(unwrap(obj["min"])),
            max: parseNumber(unwrap(obj["max"])),
            format: unwrap(obj["format"]).map { "\($0)" },
            presets: (obj["presets"] as? [Any])?.compactMap { unwrap($0).map { "\($0)" } }
        )
    }

    private static func parseNumber(_ value: Any?) -> NSNumber? {
        switch value {
        case let n as NSNumber: return n
        case let s as String: return Double(s).map { NSNumber(value: $0) }
        default: return nil
        }
    }

    private static func parseInt(_ value: Any?, fallback: Int) -> Int {
        switch value {
        case let n as NSNumber: return n.intValue
        case let s as String: return Int(s) ?? fallback
        default: return fallback
        }
    }

    private static func cloneConfig(_ source: [String: [String: MockConfigItem]]) -> [String: [String: MockConfigItem]] {
        var copy: [String: [String: MockConfigItem]] = [:]
        for (category, items) in source {
            var itemCopy: [String: MockConfigItem] = [:]
            for (name, item) in items {
                let details = item.details.map {
                    MockConfigDetails(min: $0.min, max: $0.max, format: $0.format, presets: $0.presets.map { Array($0) })
                }
                itemCopy[name] = MockConfigItem(value: item.value, options: item.options.map { Array($0) }, details: details)
            }
            copy[category] = itemCopy
        }
        return copy
    }
}
