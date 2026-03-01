import Foundation

public enum HostValidation {
    public static func sanitizeHost(_ value: String?) -> String? {
        guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }
        if raw.lowercased().hasPrefix("http://") || raw.lowercased().hasPrefix("https://") {
            return nil
        }
        if raw.contains("/") || raw.contains("\\") || raw.contains("?") || raw.contains("#") || raw.contains("@") {
            return nil
        }
        return raw
    }
}
