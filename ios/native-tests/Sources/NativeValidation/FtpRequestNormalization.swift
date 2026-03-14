import Foundation

public enum FtpRequestNormalization {
    public static func resolveTimeoutMs(_ raw: Int?) -> Int {
        min(max(raw ?? 8_000, 1_000), 60_000)
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
