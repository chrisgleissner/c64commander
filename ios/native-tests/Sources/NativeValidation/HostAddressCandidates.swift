import Foundation

/*
 * Mirror of `HostAddressCandidates` in `ios/App/App/IOSFtp.swift`, which the app target cannot
 * export to this package. `HostAddressCandidatesTests` asserts the app file holds this exact enum,
 * so the copy cannot pass while the app has drifted away.
 */
enum HostAddressCandidates {
    enum Failure: Error {
        case noAddresses
    }

    static func orderIpv4First(_ addresses: [String]) -> [String] {
        var unique: [String] = []
        for address in addresses where !unique.contains(address) {
            unique.append(address)
        }
        return unique.filter { !$0.contains(":") } + unique.filter { $0.contains(":") }
    }

    /** Splits what is left of the budget evenly over the addresses not yet tried. */
    static func attemptTimeout(remaining: TimeInterval, remainingCandidates: Int) -> TimeInterval {
        max(remaining / Double(max(remainingCandidates, 1)), 0.001)
    }

    static func connectFirstReachable<T>(
        _ candidates: [String],
        totalTimeout: TimeInterval,
        now: () -> Date = { Date() },
        attempt: (_ address: String, _ timeout: TimeInterval) throws -> T,
        onAttemptFailed: (_ address: String, _ timeout: TimeInterval, _ error: Error) -> Void
    ) throws -> (address: String, value: T) {
        let deadline = now().addingTimeInterval(totalTimeout)
        var lastError: Error?
        for (index, candidate) in candidates.enumerated() {
            let remaining = deadline.timeIntervalSince(now())
            if remaining <= 0 && lastError != nil {
                break
            }
            let timeout = attemptTimeout(remaining: remaining, remainingCandidates: candidates.count - index)
            do {
                return (candidate, try attempt(candidate, timeout))
            } catch {
                lastError = error
                onAttemptFailed(candidate, timeout, error)
            }
        }
        throw lastError ?? Failure.noAddresses
    }
}
