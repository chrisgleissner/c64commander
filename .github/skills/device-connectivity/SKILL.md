---
name: device-connectivity
description: Use when hardware validation or debugging needs the adb-attached Pixel 4 plus a reachable Ultimate device over REST in C64 Commander. Prefer u64 when both u64 and c64u are reachable.
argument-hint: (optional) validation flow or subsystem
user-invocable: true
disable-model-invocation: true
---

# Skill: Device Connectivity

## Purpose

Standardize real-device selection for Android and Ultimate hardware validation.

Targets:

- adb-attached Pixel 4 for Android app validation
- `u64` or `c64u` for REST-backed Ultimate validation

If both `u64` and `c64u` are reachable, prefer `u64`.

## Workflow

### Step 1 - Confirm Android device availability

Run:

```bash
adb devices -l
```

Prefer the attached Pixel 4 when it is listed and authorized.

### Step 2 - Probe Ultimate hardware reachability

Check both hosts explicitly:

```bash
curl -sS --max-time 5 http://u64/v1/info
curl -sS --max-time 5 http://c64u/v1/info
```

Selection rule:

1. If `u64` responds successfully, use `u64`.
2. Otherwise, if `c64u` responds successfully, use `c64u`.
3. If neither responds, record the blocker and do not claim hardware validation.

### Step 3 - Record the chosen target

When continuing with device-backed validation, log:

- whether the Pixel 4 was present
- which Ultimate host was selected
- why that host was selected

### Step 4 - Use the selected target consistently

For the rest of the validation slice:

- install and launch on the Pixel 4
- use the chosen Ultimate hostname consistently in curls, diagnostics, and notes
- avoid mixing `u64` and `c64u` evidence in one validation report without saying so explicitly

## Constraints

- Do not assume `c64u` is the preferred device when `u64` is also reachable.
- Do not claim real-device success from adb presence alone.
- Do not claim Ultimate validation from hostname resolution alone; require successful REST response.
- Preserve unrelated worktree changes while gathering hardware evidence.

## Completion Criteria

- Pixel 4 adb state checked
- `u64` and `c64u` probed explicitly
- chosen Ultimate target justified by reachability
- hardware evidence names the actual host that was used
