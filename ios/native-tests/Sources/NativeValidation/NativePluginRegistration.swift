import Foundation

public enum NativePluginRegistration {
    public static let expectedPluginClassNames = [
        "FolderPickerPlugin",
        "FtpClientPlugin",
        "SecureStoragePlugin",
        "FeatureFlagsPlugin",
        "BackgroundExecutionPlugin",
        "DiagnosticsBridgePlugin",
        "MockC64UPlugin",
        "TelnetSocketPlugin",
        "HvscIngestionPlugin",
    ]

    public static func registeredPluginClassNames(appDelegateSource: String) -> [String] {
        guard let signatureRange = appDelegateSource.range(of: "private func registerNativePluginsIfNeeded()") else {
            return []
        }

        guard let bodyStart = appDelegateSource[signatureRange.upperBound...].firstIndex(of: "{") else {
            return []
        }

        var depth = 0
        var currentIndex = bodyStart
        var bodyEnd: String.Index? = nil

        while currentIndex < appDelegateSource.endIndex {
            let character = appDelegateSource[currentIndex]
            if character == "{" {
                depth += 1
            } else if character == "}" {
                depth -= 1
                if depth == 0 {
                    bodyEnd = currentIndex
                    break
                }
            }
            currentIndex = appDelegateSource.index(after: currentIndex)
        }

        guard let resolvedBodyEnd = bodyEnd else {
            return []
        }

        let body = String(appDelegateSource[appDelegateSource.index(after: bodyStart)..<resolvedBodyEnd])
        let pattern = #"registerPluginInstance\((\w+)\(\)\)"#

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
}
