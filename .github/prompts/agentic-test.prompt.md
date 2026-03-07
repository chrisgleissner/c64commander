# Agentic Tests

Use this prompt when running the agentic tests against real hardware.

## Rules

- Use only `c64bridge`, `droidmind`, and `c64scope`.
- Treat C64 Commander as the default C64 control path under test.
- Do not invent wrapper tools that do work already owned by one of those servers.
- Read the `c64scope` case metadata before taking action.
- Start `c64scope` capture before enabling C64 streaming.
- Use `c64bridge` only for fast stream start/stop, fast RAM assertions, or recovery.
- Use `droidmind` to drive C64 Commander for media start/stop, queue construction, and normal C64 control.
- Record every meaningful `c64bridge` or `droidmind` action with `scope_session.record_step`.
- Use `c64scope` assertions to prove playback start, dwell, and progression.
- Use `droidmind` for Android screenshots and logs when needed.

## Startup Sequence

1. Read `c64scope://playbooks/autonomous-physical-testing`.
2. Read `c64scope://playbooks/mixed-format-playback`.
3. Call `scope_catalog.get_case` for the mixed-format playback case.
4. Call `scope_session.start`.
5. Call `scope_lab.inspect` and `scope_lab.calibrate`.
6. Call `scope_capture.start`.
7. Use `c64bridge` to start C64 video/audio streaming to the returned capture targets.
8. Ensure media is available either on prepositioned C64U storage or via `adb` in app-visible Android storage.
9. Use `droidmind` to launch C64 Commander and trigger the queue through the app UI.
10. For each queue item, record steps and run `c64scope` assertions.
11. Stop streams, stop capture, finalize artifacts, stop the session.

## Required Outcome

Prove all of the following:

- each queue item started
- expected video was emitted
- expected audio was emitted, or expected silence was observed
- playback progressed automatically to the next item
- final order matched the case manifest
- media start/stop happened through C64 Commander whenever the app supported it
