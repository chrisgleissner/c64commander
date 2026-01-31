# Android Emulator Smoke Tests

This folder contains Android emulator smoke tests that mirror the Playwright spec model while running against a real Android emulator.

## Structure

```
/tests/android-emulator/
  specs/      # Spec files with multiple test cases each
  helpers/    # Reusable building blocks (adb, evidence, logcat, UI, mocks)
  fixtures/   # Static assets for emulator tests
  README.md
```

## Running

Use the entrypoint script (preferred):

```bash
./scripts/smoke-android-emulator.sh --c64u-target mock
./scripts/smoke-android-emulator.sh --c64u-target real --c64u-host auto
```

Or via the local build helper:

```bash
./build --smoke-android-emulator
./build --smoke-android-emulator --c64u-target real --c64u-host C64U
```

## Evidence layout

Each test case writes evidence to:

```
test-results/evidence/android-emulator/<testName>/<deviceType>/
```

Artifacts:

- `screenshots/` numbered step screenshots
- `video.mp4` full test capture
- `logcat.txt` filtered logcat output
- `request-routing.json` parsed routing + request events
- `error-context.md` status + failure details
- `meta.json` test/device metadata

## Adding a new test

1. Copy an existing spec in `specs/` and add a new test case.
2. Use helpers from `helpers/` for setup, UI actions, and evidence capture.
3. Ensure the test creates at least one screenshot and validates discovery/routing.

Each spec must export a `spec` object:

```js
export const spec = {
  id: 'my-spec',
  title: 'My spec',
  tests: [
    {
      id: 'my-test',
      title: 'My test case',
      expected: 'Short expected behavior',
      retryable: false,
      run: async (ctx) => {
        // steps here
      },
    },
  ],
};
```
