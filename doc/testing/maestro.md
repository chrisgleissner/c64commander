# Maestro Commands (LLM syntax)

Source: https://docs.maestro.dev/api-reference/commands

## Format

```yaml
- command: name
  desc: short
  syntax: |-
    yaml
```

## Rules

## Platform Comparison Matrix

| Platform | CI runner | Flows executed in CI | High-level description |
| --- | --- | --- | --- |
| Android | `scripts/run-maestro-gating.sh` with `CI=true` | `.maestro/smoke-launch.yaml`, `.maestro/smoke-hvsc.yaml` | `smoke-launch` validates app launch and primary shell availability. `smoke-hvsc` validates core HVSC browsing/import path on device. |
| iPhone (iOS simulator) | `.github/workflows/ios-ci.yaml` matrix (`ios-maestro-tests`) | `ios-smoke-launch`, `ios-playback-basics`, `ios-diagnostics-export`, `ios-ftp-browse`, `ios-local-import`, `ios-secure-storage-persist`, `ios-import-playback`, `ios-hvsc-browse`, `ios-config-persistence` | Covers launch stability, playback controls, diagnostics dialog export path, FTP browsing, local source option visibility, secure-storage persistence, import-to-playback path, HVSC controls visibility, and config persistence across app restarts. |
| Web (Docker route via Android app) | `./build --test-maestro-docker` | `.maestro/smoke-launch.yaml`, `.maestro/smoke-hvsc.yaml` (CI-tag subset) | Builds/starts Docker web server and runs Android Maestro CI flows with app target set to `real` and host default `10.0.2.2:<docker-port>`, exercising the web route through the native client path. |

## Build helper Maestro modes

- `./build --test-maestro-ci`: Runs Android Maestro CI-critical subset against configured C64U target (`mock` by default).
- `./build --test-maestro-all`: Runs all Android Maestro flows (ignores `excludeTags`).
- `./build --test-maestro-tags <tags>`: Runs Android Maestro flows with include/exclude tag filters.
- `./build --test-maestro-docker`: Builds and starts Docker web runtime, then runs Android Maestro CI-critical subset against Docker web endpoint (default host `10.0.2.2:<docker-port>`).

### Android flow details (CI)

- `smoke-launch`: Boots app and verifies baseline UI responsiveness on emulator/device.
- `smoke-hvsc`: Verifies HVSC integration smoke path (browse/import surface) on Android.

### iPhone flow details (CI)

- `ios-smoke-launch`: Confirms app launches and primary navigation shell is reachable.
- `ios-playback-basics`: Validates basic transport/playback controls and state transitions.
- `ios-diagnostics-export`: Opens diagnostics UI and checks export-capable dialog path.
- `ios-ftp-browse`: Validates FTP source browsing behavior on iOS selectors.
- `ios-local-import`: Verifies deterministic local import source option visibility.
- `ios-secure-storage-persist`: Ensures secure-storage values persist across relaunch.
- `ios-import-playback`: Confirms import-to-playback happy path in iOS flow.
- `ios-hvsc-browse`: Validates HVSC section visibility and key actions.
- `ios-config-persistence`: Verifies settings persistence after restart.

### Tag tests for CI optimization

Use tags to control which tests run on CI versus locally:

- **`ci-critical`**: Tests that verify critical native Android components (e.g., file picker integration). These run on CI to keep build times under 6 minutes. Exclude `slow` tag from ci-critical tests.
- **`device`**: Tests that require a real Android device/emulator. These run locally by default via `--include-tags=device`.
- **`slow`**: Tests that take significant time (>30s). Excluded by default in `.maestro/config.yaml`.
- **`edge`**: Edge case tests. Excluded by default.
- **`hvsc`**: HVSC-specific integration tests. Excluded by default.
- **`file-picker`**: Tests using the native Android file picker. Subset of `device` tests.

The script `run-maestro-gating.sh` automatically uses `ci-critical` filter when `CI=true`.

### Build helper flags

Use the repo build helper to run Maestro flows locally with consistent filtering:

- `./build --test-maestro-ci` runs flows tagged `ci-critical` (CI parity).
- `./build --test-maestro-all` runs all flows, ignoring `excludeTags`.
- `./build --test-maestro-tags "+device,+file-picker,-slow"` runs with tag filters.
- `--test-apk-path <path>` overrides the APK used for Maestro runs.
- `--test-device-id <id>` targets a specific adb device.
- Maestro runs started via `./build --test-maestro-*` automatically start the Android emulator if none is running, and will prefer the emulator unless `--test-device-id` is provided.

Tag filters are comma-separated. Prefix `+` to include and `-` to exclude. Unprefixed tags are treated as includes.

### HVSC fixtures + SAF permissions

- The synthetic update archive lives at android/app/src/test/fixtures/HVSC_Update_mock.7z.
- Regenerate it with scripts/make-hvsc-7z-fixture.sh (keeps codec structure compatible with the real update).
- Unit/integration tests download HVSC_Update_84.7z once per machine via $HVSC_UPDATE_84_CACHE or ~/.cache/c64commander/hvsc.
- scripts/run-maestro.sh pre-grants storage/SAF permissions (including MANAGE_EXTERNAL_STORAGE via appops) to reduce picker dialogs.

### Timeouts

Maestro configured with stricter timeouts to ensure performance:
- LONG_TIMEOUT: 20s
- TIMEOUT: 15s
- SHORT_TIMEOUT: 5s

### Use env defaults for config-like values

Define config-like constants (app id, timeouts, fixture names, screenshot names) in `env` with fallbacks. Use the variables in commands so values can be overridden by CI or local runs.

```yaml
appId: ${APP_ID}
env:
  APP_ID: ${APP_ID || "uk.gleissner.c64commander"}
  USERNAME: ${USERNAME || "my-test-user@example.com"}
  PASSWORD: ${PASSWORD || "hunter2"}
  DEFAULT_TIMEOUT: ${DEFAULT_TIMEOUT || 10000}
---
- tapOn: "Your Username"
- inputText: ${USERNAME}
- tapOn: "Your Password"
- inputText: ${PASSWORD}
```

Keep stable UI selector strings inline unless they genuinely vary by environment (localization, build flavor, OS-specific picker labels).

Sort `env` keys alphabetically within each flow or subflow.

### Prefer conditional scroll loops

When scrolling to reach a target, prefer a `repeat` loop with a `while` condition over hard-coded scroll counts.

```yaml
- repeat:
    while:
      notVisible: "ValueX"
    commands:
      - scroll
```

## `addMedia`

Add PNG, JPEG, GIF, or MP4 media to device gallery in Maestro tests.

```yaml
- addMedia:
    - "./assets/foo.png" # path of media file in workspace
    - "./assets/foo.mp4"
```

## `assertVisible`

Confirm element visibility with assertVisible, waiting for appearance and state checks.

```yaml
- assertVisible:
    # Same exact parameters as in tapOn or any other command that uses selectors

- assertVisible: "My Button"
```

## `assertNotVisible`

Verify element disappearance with assertNotVisible using text, ID, or properties.

```yaml
- assertNotVisible:
    # Same exact parameters as tapOn

- assertNotVisible: "My Button"
```

## `assertTrue`

Assert JavaScript expressions are true in Maestro flows.

```yaml
- assertTrue: ${value}

- copyTextFrom: View A
- evalScript: ${output.viewA = maestro.copiedText}
- copyTextFrom: View B
- assertTrue: ${output.viewA == maestro.copiedText}
```

## `assertWithAI`

Verify complex UI with AI descriptions in Maestro and generate reports.

```yaml
- assertWithAI:
    assertion: Login and password text fields are visible.

- assertWithAI:
    assertion: A two-factor authentication prompt, with space for 6 digits, is visible.
```

## `assertNoDefectsWithAI`

Detect UI defects like clipped text or overlaps using experimental AI in Maestro and generate reports.

```yaml
- assertNoDefectsWithAI
```

## `back`

Navigate back on Android with back command in Maestro UI tests.

```yaml
- back
```

## `clearKeychain`

Clear iOS keychain passwords in Maestro for clean test states.

```yaml
- clearKeychain
```

## `clearState`

Remove all app data with clearState in Maestro for fresh test starts.

```yaml
- clearState            # clears the state of the current app
- clearState: app.id    # clears the state of an arbitrary app
```

## `copyTextFrom`

Copy text from elements and store in maestro.copiedText for reuse in tests or scripts.

```yaml
appId: com.example.app
---
- launchApp
- copyTextFrom:
    id: "someId"
- tapOn:
    id: "searchFieldId"
- pasteText
```

## `evalScript`

Run inline JavaScript snippets in Maestro YAML for quick tasks.

```yaml
appId: com.example
env:
    MY_NAME: John
---
- launchApp
- evalScript: ${output.myFlow = MY_NAME.toUpperCase()}
- inputText: ${output.myFlow}
```

## `eraseText`

Remove characters from text fields with eraseText in Maestro by specifying count.

```yaml
- eraseText # Removes up to 50 characters (default)

- eraseText: 100    # Removes up to 100 characters
```

## `extendedWaitUntil`

Wait for elements to appear or disappear with timeout in Maestro.

```yaml
- extendedWaitUntil:
    visible: "My text that should be visible" # or any other selector
    timeout: 10000      # Timeout in milliseconds

- extendedWaitUntil:
    notVisible:
        id: "elementId" # or any other selector
    timeout: 10000
```

## `extractTextWithAI`

Extract text from images or elements without ID using AI in Maestro and store in variables.

```yaml
- extractTextWithAI: CAPTCHA value
- inputText: ${aiOutput}

- extractTextWithAI:
    query: "CAPTCHA value"
    outputVariable: "theCaptchaValue"
```

## `hideKeyboard`

Hide virtual keyboard in Maestro tests; note potential instability on iOS.

```yaml
- hideKeyboard
```

## `inputText`

Enter text into fields in Maestro, including random emails, names, or numbers with length.

```yaml
- inputText: "Hello World"

- inputRandomEmail         # Enters a random Email address
- inputRandomPersonName    # Enters a random person name
- inputRandomNumber        # Enters a random integer number
- inputRandomText          # Enters random unstructured text
- inputRandomCityName      # Enters a random city name, worldwide
- inputRandomCountryName   # Enters the name of a random country
- inputRandomColorName     # Enters a random colour. Might be multiple words.
```

## `killApp`

Terminate app on Android with killApp (stopApp on iOS and Web) to test restarts.

```yaml
- killApp

appId: com.example
---
- pressKey: Home # Puts the app into the background
- killApp # Kills the app (adb shell am kill)
- launchApp: # Relaunches the app
    stopApp: false # Without adb shell am stop
```

## `launchApp`

Launch app in Maestro with appId, clear state/keychain, and launch arguments.

```yaml
- launchApp: appId

- launchApp:
    appId: "com.example.app"
    clearState: true
    clearKeychain: true   # optional: clear *entire* iOS keychain
    stopApp: false # optional (true by default): stop the app before launching it
    permissions: { all: deny } # optional: by default all permissions are allowed,
                               # even if clearState: true is passed
```

## `openLink`

Open links or deep links in apps or browser with Maestro, bypassing iOS security.

```yaml
- openLink: https://example.com

- openLink:
    link: https://example.com
    autoVerify: true
```

## `pressKey`

`pressKey` command allows you to press a set of special keys:

```yaml
- pressKey: Enter
```

## `pasteText`

Paste copied text into focused fields in Maestro from copyTextFrom.

```yaml
- pasteText

appId: com.example.app
---
- launchApp
- copyTextFrom:
    id: "someId"
- tapOn:
    id: "searchFieldId"
- pasteText
```

## `repeat`

A command to repeat a set commands until a condition is met.

```yaml
- repeat:
    times: 3
    commands:
      - tapOn: Button
      - scroll

- repeat:
    while:
      notVisible: "ValueX"
    commands:
      - tapOn: Button
```

## `retry`

Some flaky behaviour is expected or beyond an app's control. For those situations, it can be useful having a small controlled loop that will retry one or more commands a limited number of times.

```yaml
- retry:
    maxRetries: 3
    commands:
      - tapOn:
          id: "button-that-might-not-be-here-yet"
```

## `runFlow`

Use the runFlow command to reuse flows in Maestro. Run steps from another file, pass env arguments, or define inline commands for modular tests.

```yaml
- runFlow: anotherFlow.yaml

appId: com.example.app
---
- launchApp
- tapOn: Username
- inputText: Test User
- tapOn: Password
- inputText: Test Password
- tapOn: Login
```

## `runScript`

The `runScript` command runs a provided JavaScript file.

```yaml
appId: com.example
env:
    MY_NAME: John
---
- launchApp
- runScript: myScript.js
- inputText: ${output.myFlow}

appId: com.example
env:
    MY_NAME: John
---
- launchApp
- runScript: ../scripts/uppercase.js
```

## `scroll`

To do a simple vertical scroll you can simply run the following command:

```yaml
- scroll
```

## `scrollUntilVisible`

To scroll towards a direction until an element becomes visible in the view hierarchy, use the following command:

```yaml
- scrollUntilVisible:
    centerElement: true
    element:
      text: "Item 6"

- scrollUntilVisible:
    element: "My text" # or any other selector
    direction: DOWN
```

## `setAirplaneMode`

`setAirplaneMode` allows controlling the airplane mode of the device:

```yaml
- setAirplaneMode: enabled
- setAirplaneMode: disabled
```

## `setLocation`

`setLocation` command applies a mock geolocation to the device:

```yaml
- setLocation:
```

## `setClipboard`

Set text directly to Maestro's internal clipboard for re-use in tests or scripts. This complements copyTextFrom which copies text from UI elements.

```yaml
appId: com.example.app
---
- launchApp
- tapOn:
    id: "emailField"
- setClipboard: "custom@example.com"
- pasteText

appId: com.example.app
---
- launchApp
- setClipboard: ${'user' + Math.floor(Math.random() * 1000) + '@example.com'}
- tapOn:
    id: "emailField"
- pasteText
```

## `setOrientation`

`setOrientation` programmatically adjusts the orientation of the virtual device.

```yaml
- setOrientation: LANDSCAPE_LEFT
```

## `setPermissions`

Set permissions for an installed application.

```yaml
- setPermissions:
    permissions:
      all: allow

- setPermissions:
    appId: com.example.app
    permissions:
      camera: allow
      notifications: deny
```

## `startRecording`

To start a screen recording, add the `- startRecording: name` command to your Flow like this:

```yaml
appId: yourAppId
---
- launchApp
- startRecording: recording
...
- stopRecording
...
```

## `stopApp`

Stops current application if it is running:

```yaml
- stopApp

- stopApp: appId
```

## `stopRecording`

You can stop a running screen recording using `- stopRecording`.

```yaml
appId: yourAppId
---
- launchApp
- startRecording: name
...
- stopRecording
```

## `swipe`

To have control over the swipe gesture, you have the following choices:

```yaml
- swipe:
    start: 90%, 50% # From (90% of width, 50% of height)
    end: 10%, 50% # To (10% of width, 50% of height)

- swipe:              # This command swipes in the left direction from the middle of the device.
    direction: LEFT
```

## `takeScreenshot`

`takeScreenshot` saves a screenshot as a PNG file in the Maestro workspace.

```yaml
- takeScreenshot:
    path: LoginScreen # screenshot will be stored as LoginScreen.png

- takeScreenshot: MainScreen # screenshot will be stored as MainScreen.png
```

## `toggleAirplaneMode`

`toggleAirplaneMode` allows controlling the airplane mode of the device:

```yaml
- toggleAirplaneMode
```

## `tapOn`

Use the tapOn command in Maestro to tap by text or ID, repeat taps, adjust wait times, and handle retries for reliable UI test interactions.

```yaml
- tapOn: "My text"

- tapOn:
    id: "id" # or any other selector
```

## `doubleTapOn`

Double tap elements or points in Maestro with configurable delay and selectors. Part of Maestro testing tutorial.

```yaml
- doubleTapOn: "Button"

- doubleTapOn:
    id: "someId" # or any other selector
    delay: 100 # (optional) Delay between taps. Default, 100ms
```

## `longPressOn`

(see source)

```yaml
- longPressOn: args
```

## `travel`

(see source)

```yaml
- travel: args
```

## `waitForAnimationToEnd`

(see source)

```yaml
- waitForAnimationToEnd: args
```
