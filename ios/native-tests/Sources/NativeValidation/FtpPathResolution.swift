/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/// Mirrors the FTP path-resolution helpers from MockFtpSession for pure-Swift unit testing.
public enum FtpPathResolution {

    /// Resolves a raw FTP path against a current-working-directory string.
    ///
    /// Behaviour mirrors `MockFtpSession.resolvePath(_:)`:
    /// - An absolute path (starting with `/`) is used as-is before normalisation.
    /// - A relative path is appended to `cwd`.
    /// - `.` components are removed; `..` components pop the last segment (clamped at root).
    /// - Always returns a path that starts with `/`.
    public static func resolvePath(_ raw: String, cwd: String) -> String {
        let base: String
        if raw.hasPrefix("/") {
            base = raw
        } else if cwd.hasSuffix("/") {
            base = "\(cwd)\(raw)"
        } else {
            base = "\(cwd)/\(raw)"
        }
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

    /// Returns the parent path for a given absolute FTP path.
    ///
    /// Behaviour mirrors `MockFtpSession.parentPath(_:)`:
    /// - `/` returns `/`.
    /// - A trailing `/` is stripped before lookup.
    /// - If there is no `/` after the leading slash the result is `/`.
    public static func parentPath(_ path: String) -> String {
        if path == "/" { return "/" }
        let trimmed = path.hasSuffix("/") ? String(path.dropLast()) : path
        guard let idx = trimmed.lastIndex(of: "/"), idx != trimmed.startIndex else { return "/" }
        return String(trimmed[trimmed.startIndex..<idx])
    }
}
