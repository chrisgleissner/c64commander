/**
 * Format invariant for the version string the app renders on the home page.
 *
 * The exact version is produced at BUILD time by `scripts/resolve-version.sh`
 * from the git-tag state at that instant and baked into the immutable bundle
 * under test. The E2E job runs later, against a git state that may have moved
 * on — a release tag can land mid CI run — so re-deriving the exact string at
 * test time is inherently racy. That race is what made the "home page shows
 * resolved version" test flaky: the build baked e.g. `0.9.1-rc1-fc94d` (nearest
 * tag `0.9.1-rc1` + short SHA) while the test, seeing a freshly-pushed `0.9.1`
 * tag, expected the bare `0.9.1`.
 *
 * So instead of predicting the value, we assert the *shape* the build always
 * guarantees. The exact value and the 5-character SHA-length contract are
 * covered deterministically by the version unit tests
 * (tests/unit/scripts/resolveVersion.test.ts, tests/unit/lib/versionLabel.test.ts,
 * tests/unit/lib/buildVersion.test.ts); this invariant is the integration proof
 * that a resolved version actually renders.
 *
 * Accepted shapes (everything the build can emit):
 *   <release>                  e.g. 0.9.1            exact clean tag
 *   <release>-<pre>            e.g. 0.9.1-rc1        exact clean prerelease tag
 *   <release>[-<pre>]-<sha5>   e.g. 0.9.1-rc1-fc94d  non-exact / dirty checkout
 *
 * where <release> is MAJOR.MINOR.PATCH, <pre> is a prerelease identifier that is
 * not a run of six-or-more hex characters (so a stray SHA can't masquerade as a
 * prerelease), and <sha5> is exactly five lowercase hex characters.
 *
 * Rejected (defects the test must catch): the unresolved "—" placeholder, a
 * bare or 8-character SHA, a branch name, and "+build" metadata.
 */
export const RESOLVED_VERSION_INVARIANT =
  /^\d+\.\d+\.\d+(?:-(?![0-9a-f]{6,}(?:-|$))[0-9A-Za-z][0-9A-Za-z.]*)?(?:-[0-9a-f]{5})?$/;

/** Convenience predicate mirroring {@link RESOLVED_VERSION_INVARIANT}. */
export const isResolvedVersion = (value: string): boolean => RESOLVED_VERSION_INVARIANT.test(value);
