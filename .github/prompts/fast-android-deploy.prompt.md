---
description: Fast local Android deploy loop. Use when the user says FAST_ANDROID_DEPLOY, fast deploy, quick deploy, device loop, or no-coverage deploy to push code to the attached phone without running tests or coverage.
---

# Fast Android Deploy

Use this prompt for rapid local iteration on the adb-attached Android device.

This is an execution prompt, not an analysis prompt.

The goal is to get the current code onto the locally attached device as quickly as possible.

---

# Trigger Conditions

This prompt applies when the user explicitly asks for a fast local deploy using any of these keywords or phrases:

- `FAST_ANDROID_DEPLOY`
- `fast deploy`
- `quick deploy`
- `device loop`
- `no-coverage deploy`

If none of those appear, do not assume this mode.

---

# Required Behavior

1. Make the requested code changes.
2. Do not run lint, tests, coverage, screenshots, CI workflows, or review prompts unless the user explicitly asks.
3. Prefer the local deploy command:

```bash
./build --skip-tests --install-apk
```

4. Do not pass `--device-id` unless:
   - more than one physical device is attached
   - or the user explicitly names a device
5. If installation fails because the existing package blocks replacement, uninstall `uk.gleissner.c64commander` from the selected device and retry once.
6. Launch the app after install and report the measured wall-clock duration for the deploy command.

---

# Validation Scope

In this mode, validation is intentionally narrow:

- confirm the code change is applied
- confirm the APK installs on the attached device
- confirm the app launches
- report elapsed deploy time

Do not add coverage or full-suite validation to this workflow unless the user explicitly asks to widen scope.

---

# Exit Criteria

Stop when all of the following are true:

- the requested change is implemented
- the APK is installed on the attached device
- the app launches successfully
- the elapsed deploy time is reported

---

# Override Rule

This prompt is only for local debug velocity.

If the user switches to `.github/prompts/pr-converge.prompt.md` or explicitly asks to converge the PR, this shortcut is overridden and full repository validation, including coverage, becomes mandatory again.
