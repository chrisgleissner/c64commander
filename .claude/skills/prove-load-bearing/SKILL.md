---
name: prove-load-bearing
description: >-
  Prove a regression test actually fails without its fix, by removing the mechanism,
  watching the test go red, and restoring it. Use after writing any regression test on this
  repo — the standing rule is that every fix has a test verified to fail without it. Also
  use when a test "passes" and you want to know whether it is testing anything at all.
---

# Prove a test is load-bearing

A regression test that passes with and without the fix is worse than no test: it certifies
nothing while looking like assurance. Verify by removal, every time.

## The procedure

**1. Assert the anchor exists before replacing it.** This is the whole safety of the
method. A `replace` whose pattern silently does not match leaves the code untouched, the
test still passes, and you conclude the fix is load-bearing when you have proved nothing.
That has happened here twice.

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path("src/lib/thing.ts")
s = p.read_text()
old = "the exact line that implements the fix"
assert old in s, "anchor missing — the removal would not have applied"
p.write_text(s.replace(old, "// TEMPORARILY DISABLED to prove the gate"))
print("disabled")
PY
```

**2. Run the specific test and expect RED.**

```bash
npx vitest run tests/unit/foo.test.ts -t "the assertion name"
# or, for native:
cd android && ./gradlew :app:testDebugUnitTest --tests '*FooTest.theAssertionName*'
```

**3. Restore, asserting the marker exists.**

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path("src/lib/thing.ts")
s = p.read_text()
old = "// TEMPORARILY DISABLED to prove the gate"
assert old in s
p.write_text(s.replace(old, "the exact line that implements the fix"))
print("restored")
PY
```

**4. Re-run and expect GREEN.** Then confirm nothing is left behind:
`grep -c "TEMPORARILY DISABLED" <file>` must be 0.

## When it passes without the fix

That is a real result, not a failure of the exercise. It means something *else* is covering
the case. Two live examples from this repo:

- An adaptive-cushion mechanism in `AudioPipeline` was disabled and the gate still passed —
  because the ring buffer alone absorbed the burst pattern. Useful: it showed which change
  was actually doing the work.
- A pitch-period refinement was disabled and the click gate still passed at 440 Hz, because
  the cross-fade dominated. It only bites at high frequencies where the period is short.

**Report it rather than quietly strengthening the test until it fails.** Say which mechanism
turned out not to be load-bearing under that test, and either add a case that isolates it
(a higher tone, a longer run) or accept that the test covers the outcome and not that
particular mechanism.

## Gradle reports do not print assertion messages

`./gradlew test` prints `FAILED` and nothing useful. Extract the message from the XML:

```bash
python3 - <<'PY'
import glob, re, html, pathlib
for f in glob.glob("app/build/test-results/testDebugUnitTest/*.xml"):
    t = pathlib.Path(f).read_text()
    for m in re.finditer(r'<testcase name="([^"]+)"[^>]*>\s*<failure[^>]*>(.*?)</failure>', t, re.S):
        print("FAIL:", m.group(1), "::", html.unescape(m.group(2)).split("\n")[0][:250])
PY
```

## Amending an existing test

Before changing an assertion to make it pass, ask: **does the new behaviour make sense to a
user?** If not, it is a regression and the production code is wrong. If it does, amend it
and say so in a comment on the test — what changed, and why the new behaviour is better.
Two tests were legitimately amended on #326 and both carry that comment.
