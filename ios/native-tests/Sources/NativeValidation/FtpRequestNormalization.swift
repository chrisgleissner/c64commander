import Foundation

public enum FtpRequestNormalization {
    /* The control channel: bounds one command/response exchange. Unchanged by HARD27-012. */
    public static func resolveTimeoutMs(_ raw: Int?, defaultMs: Int = 8_000) -> Int {
        min(max(raw ?? defaultMs, 1_000), 60_000)
    }

    /*
     * The data transfer: an idle timeout between chunks, not a deadline for the whole transfer.
     * Mirrors `FtpRequestOptions.resolveTransferTimeout` in `ios/App/App/IOSFtp.swift` and matches
     * Android's `resolveTransferTimeoutMs`.
     *
     * `0` explicitly means "no idle timeout", returned here as nil. The songlengths read from the
     * Ultimate sends it, because a truncating timeout can wedge the firmware's FTP data channel.
     * The previous code ran that value through `resolveTimeoutMs`, which turned it into 1 s, so
     * the read returned a truncated buffer and the songlengths import reported failure
     * (HARD27-012).
     */
    public static func resolveTransferTimeoutMs(_ raw: Int?, defaultMs: Int = 8_000) -> Int? {
        guard let raw else { return defaultMs }
        if raw == 0 { return nil }
        return min(max(raw, 1_000), 600_000)
    }

    /* Mirrors `FtpSession.maxReadFileBytes` and `FolderPickerPlugin.maxReadFileBytes`. */
    public static let maxReadFileBytes = 32 * 1024 * 1024

    public static func maximumReadableSizeMessage(maxBytes: Int = maxReadFileBytes) -> String {
        "File exceeds the maximum readable size (\(maxBytes / (1024 * 1024))MB)"
    }

    public static func resolveTraceDetails(_ trace: [String: Any]?) -> [String: Any] {
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
            guard let value = trace[key] else { return }
            details[key] = value
        }
    }
}

public enum FtpPluginContract {
    public static let expectedExportedMethods = [
        "listDirectory",
        "readFile",
        "writeFile",
        "makeDirectory",
        "pingFtp",
        "cancelRead",
        "listDirectoryRecursive",
    ]

    public static func exportedMethodNames(source: String) -> [String] {
        guard let pluginRange = source.range(of: "public final class FtpClientPlugin") else {
            return []
        }
        guard let methodsRange = source[pluginRange.upperBound...].range(of: "public let pluginMethods") else {
            return []
        }
        guard let assignment = source[methodsRange.upperBound...].firstIndex(of: "=") else {
            return []
        }
        guard let bodyStart = source[assignment...].firstIndex(of: "[") else {
            return []
        }
        guard let bodyEnd = source[bodyStart...].firstIndex(of: "]") else {
            return []
        }

        let body = String(source[source.index(after: bodyStart)..<bodyEnd])
        let pattern = #"CAPPluginMethod\(name:\s*"([^"]+)""#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return []
        }

        let nsBody = body as NSString
        return regex.matches(in: body, range: NSRange(location: 0, length: nsBody.length)).compactMap { match in
            guard match.numberOfRanges > 1 else {
                return nil
            }
            return nsBody.substring(with: match.range(at: 1))
        }
    }

    public static func objcHandlerNames(source: String) -> Set<String> {
        let pattern = #"@objc\s+public\s+func\s+(\w+)\s*\("#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return []
        }

        let nsSource = source as NSString
        let matches = regex.matches(in: source, range: NSRange(location: 0, length: nsSource.length))
        return Set(matches.compactMap { match in
            guard match.numberOfRanges > 1 else {
                return nil
            }
            return nsSource.substring(with: match.range(at: 1))
        })
    }
}
