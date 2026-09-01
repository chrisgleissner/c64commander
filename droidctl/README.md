# droidctl

MCP server that deploys and drives the Android application under test. It is the device-driving peer
that `c64scope` calls: `c64scope` owns sessions, evidence timelines and assertion records, `droidctl`
owns install, lifecycle, raw input, capture, logs and the WebView port forward.

## Quick start

```bash
cd droidctl
npm install
npm run check          # build + test
npm run mcp            # start MCP server (stdio transport)
node scripts/start.mjs # bootstrap deps if needed, then start from TypeScript
```

## Repository scripts (from root)

```bash
npm run droid:build          # compile TypeScript
npm run droid:test           # run unit tests
npm run droid:test:coverage  # run tests with coverage
npm run droid:check          # build + test
npm run droid:mcp            # start MCP server
```

`.mcp.json` starts `droidctl/scripts/start.mjs`, which installs the package's own dependencies on first
start. `scripts/setup-agentic-mcp.mjs` is the single writer of MCP configuration across `.mcp.json`,
`~/.codex/config.toml` and `~/.claude.json`; `droidctl` is registered there.

## Target selection

**Every tool takes an explicit `targetId` and refuses to guess.** There is no default target, no "the
only connected device" fallback and no prefix that resolves to a single candidate. A target id that
matches nothing is `target_not_found`; one that matches more than one device is `ambiguous_target`
listing the candidates. Call `droid_target.list_targets` first and pass an id it returned.

Every tool that names an application takes an explicit `package`, because two application ids can be
installed at once and both open a WebView DevTools socket.

`droidctl://reference/targeting-rules` serves the full rule list as an MCP resource.

Resolution is deliberately not cached. Every tool call lists the devices again, which is the server's
only check that the target is still attached: a device that disconnected or became ambiguous since the
previous call is refused rather than acted on. Measured against the Pixel 4 on USB, that listing costs
3.6 ms median, against a 14.9 ms floor for any single `adb shell` round trip the tool must then make —
18.5% of the cheapest possible call (`run_shell ["true"]`, 19.2 ms) and 5.5% of a tap-shaped one
(64.2 ms). `tests/targeting.test.ts` fails if a resolution cache is introduced.

`apiLevel` is populated by reading `ro.build.version.sdk`. That read is cached per connection rather
than per listing: the cache is keyed on the serial plus adb's transport id, which changes whenever a
device reattaches, and entries for devices absent from a listing are dropped. So a device is read once
when it attaches and never again, which keeps the per-call listing at 3.6 ms; the first listing after a
device attaches costs 23.5 ms. A target not in state `device` is never queried and reports a null
`apiLevel`.

## Tool surface

| Domain          | Tools                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `droid_target`  | `list_targets`, `describe_target`                                                                             |
| `droid_app`     | `install_app`, `uninstall_app`, `launch_app`, `stop_app`, `clear_app_data`, `write_app_file`, `read_app_file` |
| `droid_input`   | `tap`, `swipe`, `type_text`, `press_key`                                                                      |
| `droid_capture` | `screenshot`, `ui_hierarchy`, `start_recording`, `stop_recording`, `logcat`                                   |
| `droid_assert`  | `assert_visible`, `assert_not_visible`                                                                        |
| `droid_device`  | `prepare_device`, `run_shell`, `forward_webview`, `push_file`, `pull_file`                                    |

The JSON Schema advertised over `tools/list` is derived from each tool's zod schema by
`src/tools/jsonSchema.ts`, so there is no second declaration to drift: a constraint enforced at execute
time is advertised, and a construct the derivation cannot express fails at import instead of quietly
understating the validator. The one thing it cannot carry is a zod `.refine()`, which is a runtime-only
predicate; `tests/contract.test.ts` lists each of those explicitly and asserts the disagreement is real.
`tests/fixtures/advertisedSurface.json` locks the surface callers see, so a change to it is deliberate.

## Transports

One interface, two backends, so a caller does not branch on which is in use.

- **`adb`** — the physical handset on USB, Android emulators, and containers reached with
  `adb connect`. Every invocation carries `-s <serial>`; only enumeration runs without one.
- **`ssh`** — a stub for a host that runs the same Android build inside a compatibility container,
  reached over SSH rather than over adb. No such device exists on this bench, so it returns
  `transport_unavailable` with the probe procedure that would settle each open question, and points at
  `docs/plans/droidctl/spec.md` §14 for the literal commands. Nothing is gated on that hardware.

`droidctl://reference/transport-support` serves the per-tool support matrix.

## Assertions

`droid_assert.assert_visible` decides visibility from the uiautomator hierarchy — the same
accessibility tree Maestro uses — and never from image comparison. `requireOnScreen` defaults to true
and intersects the node's bounds with the screen rectangle, so a node scrolled off the viewport does
not count as visible. A false assertion is a result with `passed: false` and an evidence pair, not an
exception; each candidate node carries the `rejectedBy` predicate, which keeps "not there", "there but
disabled" and "there but off-screen" apart.

`resourceId` matches the accessibility `resource-id`, which for a WebView element is its HTML `id`
attribute and **not** its `data-testid`. A harness that needs a testid keeps using CDP, over the port
forward from `droid_device.forward_webview`.

## Artifacts

Written under `artifacts/droidctl/<runId>/`, overridable per call with `runRoot` and by
`DROIDCTL_ARTIFACT_ROOT`:

```
artifacts/droidctl/dc-20260831T142530Z/
  index.json          # every artifact this run produced, with tool, timestamp and target
  raw/<name>.png      # screenshots at native resolution
  review/<name>-review.png
  hierarchies/<name>.xml
  video/<name>.mp4
  logs/logcat/<name>.log
  commands.jsonl      # every transport invocation: argv, exit code, duration, target id
```

PNG and MP4 signatures are checked at capture time, so a zero-byte capture fails where it happened
rather than at evidence validation later.

## Hardware check

Unit tests run against a faked transport and need no device. The operations that genuinely need
hardware are covered by one manual script, which is not wired into any gate:

```bash
node droidctl/scripts/smoke-device.mjs --target <targetId> --package <applicationId>
```

Set `DROIDCTL_DEBUG=1` for debug logging on stderr.
