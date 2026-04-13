import Foundation

public enum TelnetRequestValidation {
    public static func resolvePort(_ value: Int) -> Result<Int, NativePluginError> {
        guard (1...65_535).contains(value) else {
            return .failure(.invalidArgument("port must be between 1 and 65535"))
        }
        return .success(value)
    }

    public static func resolveTimeoutMs(_ value: Int) -> Result<Int, NativePluginError> {
        guard value > 0 else {
            return .failure(.invalidArgument("timeoutMs must be greater than 0"))
        }
        return .success(value)
    }
}
