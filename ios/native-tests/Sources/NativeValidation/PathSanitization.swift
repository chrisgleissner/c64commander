/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import Foundation

/// Mirrors the NativePluginError enum from NativePlugins.swift for pure-Swift unit testing.
public enum NativePluginError: LocalizedError {
    case invalidArgument(String)
    case unavailable(String)
    case operationFailed(String)

    public var errorDescription: String? {
        switch self {
        case .invalidArgument(let message): return message
        case .unavailable(let message): return message
        case .operationFailed(let message): return message
        }
    }
}

/// Mirrors the sanitizeRelativePath helper from FolderPickerPlugin for pure-Swift unit testing.
public enum PathSanitization {
    /// Strips empty components and rejects parent-traversal segments.
    /// - Throws: `NativePluginError.invalidArgument` when `..` is found.
    public static func sanitizeRelativePath(_ input: String) throws -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        let components = trimmed.split(separator: "/").map(String.init).filter { !$0.isEmpty }
        if components.contains("..") {
            throw NativePluginError.invalidArgument("path must not contain parent traversal")
        }
        return components.joined(separator: "/")
    }
}
