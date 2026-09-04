import Foundation

/*
 * Mirror of the cancellation registry in `ios/App/App/IOSFtp.swift`.
 *
 * The app target is not importable from this package, so the logic is duplicated here the same way
 * `FtpRequestNormalization` mirrors the request normalisation. The behavioural cases in
 * `FtpReadCancellationTests` run against this copy; the source assertions in the same file read
 * the app file directly, so the copy cannot pass while the app has drifted away from it.
 */
public final class FtpReadCancellationToken {
    private let lock = NSLock()
    private var cancelled = false

    public init() {}

    public var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    public func cancel() {
        lock.lock()
        defer { lock.unlock() }
        cancelled = true
    }
}

public final class FtpReadCancellationRegistry {
    private let lock = NSLock()
    private var tokens: [String: FtpReadCancellationToken] = [:]

    public init() {}

    public func register(requestId: String) -> FtpReadCancellationToken {
        let token = FtpReadCancellationToken()
        lock.lock()
        defer { lock.unlock() }
        tokens[requestId] = token
        return token
    }

    public func release(requestId: String) {
        lock.lock()
        defer { lock.unlock() }
        tokens.removeValue(forKey: requestId)
    }

    /* Returns false when the read already finished, which is not an error for any caller. */
    @discardableResult
    public func cancel(requestId: String) -> Bool {
        lock.lock()
        let token = tokens[requestId]
        lock.unlock()
        token?.cancel()
        return token != nil
    }
}
