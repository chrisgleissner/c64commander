import Foundation

/*
 * Mirror of the recursive FTP walk in `ios/App/App/IOSFtp.swift`.
 *
 * The app target is not importable from this package, so the traversal is duplicated here the way
 * `FtpRequestNormalization` mirrors the request normalisation. `FtpRecursiveWalkTests` exercises
 * this copy against a fake lister and asserts the app file agrees with it, so the copy cannot pass
 * while the app has drifted away.
 *
 * The caps and the early-exit rule come from Android, deliberately: both plugins answer the same
 * TypeScript contract, and a truncated walk is reported through `partialFailures` and `timedOut`
 * rather than presented as a complete listing (HARD9-078, HARD9-081).
 */
public struct FtpWalkEntry: Equatable {
    public let name: String
    public let path: String
    public let type: String

    public init(name: String, path: String, type: String) {
        self.name = name
        self.path = path
        self.type = type
    }

    public var isDirectory: Bool { type == "directory" }
}

public struct FtpWalkFailure: Equatable {
    public let path: String
    public let message: String

    public init(path: String, message: String) {
        self.path = path
        self.message = message
    }
}

public struct FtpWalkResult: Equatable {
    public var entries: [FtpWalkEntry] = []
    public var failures: [FtpWalkFailure] = []
    public var timedOut = false

    public init() {}
}

public struct FtpWalkListingTimeout: Error {
    public let message: String
    public init(message: String) { self.message = message }
}

public enum FtpRecursiveWalkLimits {
    public static let defaultMaxDepth = 8
    public static let defaultMaxEntries = 5_000

    public static func clampDepth(_ raw: Int?) -> Int { min(max(raw ?? defaultMaxDepth, 0), 32) }
    public static func clampEntries(_ raw: Int?) -> Int { min(max(raw ?? defaultMaxEntries, 1), 50_000) }

    public static func cappedMessage(maxEntries: Int) -> String {
        "FTP recursive listing stopped after \(maxEntries) entries"
    }

    public static func maxDepthMessage(maxDepth: Int) -> String {
        "FTP recursive listing max depth \(maxDepth) reached"
    }
}

public func walkFtpDirectory(
    root: String,
    maxDepth: Int,
    maxEntries: Int,
    list: (String) throws -> [FtpWalkEntry]
) -> FtpWalkResult {
    var result = FtpWalkResult()
    var queue: [(path: String, depth: Int)] = [(root, 0)]
    var visited = Set<String>()
    var examined = 0
    var capped = false

    while !queue.isEmpty && !capped && !result.timedOut {
        let current = queue.removeFirst()
        if !visited.insert(current.path).inserted { continue }

        let files: [FtpWalkEntry]
        do {
            files = try list(current.path)
        } catch let timeout as FtpWalkListingTimeout {
            result.failures.append(FtpWalkFailure(path: current.path, message: timeout.message))
            result.timedOut = true
            break
        } catch {
            result.failures.append(FtpWalkFailure(path: current.path, message: error.localizedDescription))
            continue
        }

        for file in files {
            examined += 1
            if examined > maxEntries {
                result.failures.append(
                    FtpWalkFailure(path: current.path, message: FtpRecursiveWalkLimits.cappedMessage(maxEntries: maxEntries))
                )
                capped = true
                break
            }
            if file.isDirectory {
                if current.depth < maxDepth {
                    queue.append((file.path, current.depth + 1))
                } else {
                    result.failures.append(
                        FtpWalkFailure(path: file.path, message: FtpRecursiveWalkLimits.maxDepthMessage(maxDepth: maxDepth))
                    )
                }
            } else {
                result.entries.append(file)
            }
        }
    }

    return result
}
