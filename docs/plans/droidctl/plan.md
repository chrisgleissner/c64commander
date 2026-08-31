# droidctl — Implementation Plan

Read `spec.md` first. This document is the sequence, not the design.

## Required reading

- `docs/plans/droidctl/spec.md`
- `c64scope/src/server.ts`, `c64scope/src/tools/registry.ts`, `c64scope/src/tools/types.ts`,
  `c64scope/src/types.ts` — the structure this copies
- `c64scope/src/validation/droidmindClient.ts` — the behaviour being replaced
- `c64scope/scripts/start.mjs` and `.mcp.json` — how an in-repo MCP server is launched
- `tools/hil/README.md` — the hidden-WebView trap, which any new device tool must respect
- `AGENTS.md:999-1021` — the rig that exists, and the rule against gating on hardware that does not

## Sizing

An audit of the repository found **39 files under `tools/hil/` and `scripts/` that shell out to `adb`,
totalling about 242 invocation lines**. Those reduce to **25 tools across six modules**. About 141 of the
call sites already pass `-s`; roughly 98 do not, and four of those files run destructive operations —
`install`, `uninstall`, `pm clear`, `ime disable` — against whatever `adb` happens to pick.

Phases are sized by counted work items rather than by time. No phase is estimated in hours.

**Phase 3 delivers the first genuinely useful capability.** Phases 0 to 2 produce a server that answers
`tools/list` and can enumerate a device, which is scaffolding. At the end of phase 3 a caller can
install a build, launch it, tap, screenshot and read the hierarchy — everything the CTA runners need
from `droidmind`, minus assertions. Phase 5 is the one that lets `droidmind` be removed.

Phases 0 to 4 are a self-contained pull request: a new directory, no existing file changed except
`.mcp.json`, `package.json` and `scripts/setup-agentic-mcp.mjs`. Nothing else in the repository depends
on it until phase 7.

---

## Phase 0 — The package skeleton

**6 files, no tools yet.**

- [ ] Create `droidctl/` with `package.json`, `tsconfig.json`, `vitest.config.ts` and
      `scripts/start.mjs`, each copied from the `c64scope/` equivalent and renamed. Keep the same
      `engines` block (`node >=24 <25`), the same `"type": "module"`, and the same
      `build` / `test` / `test:coverage` / `check` / `mcp` scripts.
- [ ] Pin `@modelcontextprotocol/sdk` with a caret and commit `droidctl/package-lock.json`. This is the
      one thing `droidmind` did not do, and it is the reason this work exists — an unbounded range let a
      breaking major in.
- [ ] Copy the coverage thresholds from `c64scope/vitest.config.ts:33-40` (90 / 85 / 90 / 90), excluding
      only `src/index.ts` and `scripts/smoke-device.mjs`.
- [ ] Add the root-level wrappers to `package.json` alongside the existing `scope:*` ones:
      `droid:build`, `droid:test`, `droid:test:coverage`, `droid:check`, `droid:mcp`, each a
      `cd droidctl && npm run …`.
- [ ] Add `droidctl` to `.mcp.json` as `{"command": "node", "args": ["droidctl/scripts/start.mjs"]}`, and
      add it to the `serverNames` array at `scripts/setup-agentic-mcp.mjs:15` — that script is the single
      writer of MCP config across `.mcp.json`, `~/.codex/config.toml` and `~/.claude.json`, so a server
      missing from it will be silently dropped the next time the setup runs.
- [ ] Add `droidctl/artifacts/` and `droidctl/logs/` to `.gitignore`, matching the existing
      `c64scope/**/artifacts/` entry.

## Phase 1 — The server shell

**7 source files, 2 test files.**

- [ ] `src/logger.ts`, `src/tools/types.ts`, `src/tools/errors.ts`, `src/tools/responses.ts`,
      `src/tools/registry.ts`, `src/types.ts` — copy the c64scope originals with the identifiers renamed.
      Keep `defineToolModule`, `parseZodArgs`, `ToolValidationError` and the duplicate-name throw at
      `c64scope/src/tools/registry.ts:38-42` exactly as they are; they are load-bearing for phase 2's
      contract test.
- [ ] `src/types.ts` keeps c64scope's envelope — `okResult` / `errorResult` returning
      `{ok, runId, timestamp, data}` and `{ok:false, runId, timestamp, error:{code,message,details}}` —
      and `createRunId()` with the `dc-` prefix instead of `pt-`.
- [ ] `src/server.ts` and `src/index.ts`, modelled on `c64scope/src/server.ts:47-166`: five request
      handlers (`tools/list`, `tools/call`, `resources/list`, `resources/read`, and the prompts pair only
      if a prompt is actually shipped), `StdioServerTransport`, and the `unknownErrorResult` wrapper on
      the tool-call path.
- [ ] Server handler tests modelled on `c64scope/tests/serverHandlers.test.ts`, reaching handlers off the
      `Server` instance rather than opening a transport.
- [ ] `npm run droid:check` is green with an empty tool registry.

## Phase 2 — The transport abstraction and the targeting rules

**3 source files, 2 test files. This phase contains the whole reason the server exists.**

- [ ] `src/transport/types.ts` — the `Transport` interface from `spec.md` §7.2, `TargetInfo`,
      `ResolvedTarget`, `TransportCapabilities`, and the `unsupported_on_transport` error.
- [ ] `src/transport/adb.ts` — `adbArgs(serial, rest)` as a **pure exported function**, plus `exec`,
      `pullBinary`, `pushFile`, `installPackage`, `forwardPort` and `listTargets` built on it. Every
      invocation carries a timeout; binary reads use `exec-out` with a buffer encoding, as
      `scripts/hil-screenshot-evidence.mjs:67-79` does.
- [ ] `src/transport/registry.ts` — resolves a `targetId` to a `ResolvedTarget`. Implements spec §6.3
      rules 1 to 5: no default, no single-device fallback, ambiguity is `ambiguous_target`, a stale id is
      `target_not_found`.
- [ ] `src/transport/fake.ts` — the scripted transport every later test uses. It records every call so a
      test can assert on the sequence, not only on the result.
- [ ] `tests/targeting.test.ts` — the six tests in `spec.md` §11.2, in one file so a reviewer can find
      them. The property test over `adbArgs` is the one that must not be weakened.
- [ ] Verify the tests can fail: temporarily re-introduce the
      `if (serials.length === 1) return serials[0]` fallback from `scripts/build-android-apks.mjs:248`
      into `registry.ts` and confirm the ambiguity and stale-id tests go red. Revert it.

## Phase 3 — The tools the CTA runners need

**4 tool modules, 13 tools, and the first useful capability.**

- [ ] `src/tools/modules/target.ts` — `list_targets`, `describe_target`. `describe_target` parses the
      `Override size:` line, because `tools/hil/merge_gate.mjs:761-766` is currently the only place that
      knows a leftover override fails the input and clarity stages with no code fault.
- [ ] `src/tools/modules/app.ts` — `install_app`, `uninstall_app`, `launch_app`, `stop_app`,
      `clear_app_data`. `install_app` verifies with `pm list packages` and reports
      `INSTALL_FAILED_UPDATE_INCOMPATIBLE` with the uninstall-first remedy, which `AGENTS.md:161` and
      `scripts/run-maestro.sh:219-220` currently perform by hand. `clear_app_data` requires
      `confirm: true`.
- [ ] `src/tools/modules/input.ts` — `tap`, `swipe`, `type_text`, `press_key`. Do the CSS-to-physical
      conversion once, here; today `tools/hil/sid_radio_bug_bash_hil.mjs:190` and
      `tools/hil/sid_radio_edge_cases_hil.mjs:118` each write their own `Math.round(g.cx * DPR)`. Reject
      coordinates outside the screen rectangle before injecting — an off-screen tap silently does nothing
      and reads downstream as an app fault.
- [ ] `src/tools/modules/capture.ts` — `screenshot`, `ui_hierarchy`. Port the settle-and-retry loop from
      `c64scope/src/validation/droidmindClient.ts:213-267` and the per-call deadline from `:283-296`
      exactly; both exist because a wedged `uiautomator dump` blocked a gate runner for over five
      minutes. Port the raw/review 480 px downscale from `scripts/hil-screenshot-evidence.mjs:29-65`.
- [ ] `src/artifacts.ts` — run directory allocation, `index.json`, and `commands.jsonl` recording every
      transport invocation with its argv, exit code, duration and target id.
- [ ] Check magic bytes at capture time, mirroring `scripts/validate-playwright-evidence.mjs:32-50`, so a
      zero-byte capture fails where it happened rather than at evidence validation an hour later.
- [ ] Module tests against the fake transport, modelled on `c64scope/tests/toolCoverage.test.ts`,
      including the failure paths: an incompatible install, a dump with no `<hierarchy` root, an empty
      screenshot buffer.
- [ ] The contract test from `spec.md` §11.3, walking the registry so a tool added later is covered the
      day it is added.

## Phase 4 — Recording, logs, and device readiness

**3 modules extended, 10 more tools.**

- [ ] `droid_capture.start_recording` / `stop_recording` — detached `screenrecord`, `SIGINT` to the local
      child, pull, delete. Copy the shape from `scripts/smoke-android-emulator.sh:617-647` and
      `c64scope/src/hilEvidenceRun.ts:271-302`, including the 180 s default limit and the 6 Mbit/s bit
      rate. Verify the MP4 `ftyp` box on pull.
- [ ] `droid_capture.logcat` — `-c` and `-d`, with `-t`, `-v`, `--pid` and `-s` options, plus
      server-side regular-expression filters returning `matchedCount` and the matching lines. Every
      caller greps afterwards today; `scripts/bughunt-capture.sh:25` and
      `scripts/run-pixel4-c64u-soak.mjs:414-424` are the two shapes to satisfy. Carry over the check at
      `c64scope/src/validation/helpers.ts:61-73` that throws when a capture has no runtime content.
- [ ] `src/tools/modules/device.ts` — `prepare_device`, `run_shell`, `forward_webview`, `push_file`,
      `pull_file`. `prepare_device` covers the whole readiness cluster in `spec.md` §8.12.
- [ ] `forward_webview` takes a **required** `package`. Both application ids can be installed at once and
      both open a DevTools socket; picking the first one attaches to the wrong app, and the other edition
      may still hold an `AudioTrack` and corrupt an audio measurement. Support both pid-resolution
      methods — `pidof` and the `/proc/net/unix` regex — with the second as the fallback when the first
      returns more than one pid.
- [ ] `droid_app.write_app_file` / `read_app_file` over `run-as`, with the path confined to the app's
      `files/` directory. Detect a `run-as` refusal rather than returning an empty body with exit code 0;
      `c64scope/src/validation/cases/system.ts:53` already falls back to `pm dump` for that reason.

## Phase 5 — Assertions

**1 module, 2 tools, and the check the repository does not have today.**

- [ ] `src/tools/modules/assert.ts` — `assert_visible` and `assert_not_visible` over the hierarchy dump,
      per `spec.md` §9.2.
- [ ] Implement `requireOnScreen` as an intersection with the screen rectangle from `describe_target`.
      `c64scope/src/cta/uiHelpers.ts:27` currently treats any non-degenerate bounds as visible, so a node
      scrolled far off the viewport counts as visible; that is the gap this closes.
- [ ] Return `rejectedBy` per candidate node, so "not there", "there but disabled" and "there but
      off-screen" are three distinguishable results rather than one `false`.
- [ ] Write the evidence pair — hierarchy XML and a screenshot taken at the same moment — on failure,
      before returning.
- [ ] State in the `resourceId` field description that it matches the HTML `id`, not `data-testid`.
      `.maestro/smoke-hvsc.yaml:57-59` documents that `CollapsibleSection` sets the HTML id deliberately
      so `id:` works at all; a caller who does not know this writes an assertion that fails on a fully
      rendered page.
- [ ] Tests that prove each rejection reason independently: present-and-visible, present-but-disabled,
      present-but-off-screen, absent. Confirm they fail by removing the `requireOnScreen` intersection —
      the off-screen case must then pass, which is the bug.

## Phase 6 — Resources, the Sailfish stub, and the smoke script

**3 source files, 1 script.**

- [ ] `src/resources.ts` — the Android keycode table (name to number, both directions) and the transport
      support matrix from `spec.md` §8.15, served as MCP resources so a caller reads them rather than
      hard-coding a table. `tools/hil/keypad_reachability.mjs:58` is the set that must be present.
- [ ] `src/transport/sailfish.ts` — the stub. It returns `transport_unavailable` with the §14 probe
      procedure in the message. Its comments carry the two rules from `spec.md` §7.4: verify by artifact
      rather than exit code, because `uiautomator dump` under `appsupport-attach` has been observed
      returning 0 while writing nothing; and prefer a container adb connection if one can be established,
      because that collapses most of §14.
- [ ] Unit-test the stub: every capability reports unsupported, and the message names the check that
      would settle it. **Do not write a task, gate or acceptance item whose venue is a Sailfish device.**
      `AGENTS.md:1004-1015` is explicit that such an item is not blocked but unrunnable.
- [ ] `droidctl/scripts/smoke-device.mjs` — the manual hardware script from `spec.md` §11.6. It takes a
      required `--target`, refuses to run without one, and writes an artifact bundle. It is not wired into
      any gate.

## Phase 7 — Migrate the c64scope client

**1 file replaced, 2 test files updated.**

- [ ] Replace `c64scope/src/validation/droidmindClient.ts` with a droidctl client. The nine required
      capabilities at `c64scope/src/cta/capabilities.ts:27-37` map one-to-one onto droidctl tools; update
      that list rather than deleting it, so preflight still fails loudly when a tool is missing.
- [ ] Keep `scrollDown` (`droidmindClient.ts:180-189`) in c64scope. It swipes and compares hierarchy keys
      to detect the end of a list, which is UI-walking policy, not a device operation.
- [ ] The retry loop and the per-call deadline move to droidctl and come out of the client. Do not leave
      both.
- [ ] Update `c64scope/tests/droidmindClient.test.ts` and `c64scope/tests/ctaCapabilities.test.ts`.
- [ ] Run one CTA gate against the rig, with an explicit target, and record which gate and which run id.

## Phase 8 — Migrate the capture helpers and the deploy path

**3 scripts changed.**

- [ ] `scripts/hil-screenshot-evidence.mjs` and `scripts/bughunt-capture.sh` become droidctl callers. The
      hard-coded serial at `bughunt-capture.sh:6` becomes a required target argument.
- [ ] `scripts/build-android-apks.mjs` — the step list at `planVariantAdbSteps` (`:152-198`) already has a
      test-facing export, so the steps become droidctl calls without restructuring. **This is the change
      that deletes `if (serials.length === 1) return serials[0]` at `:246`.**
- [ ] Give `tools/hil/merge_gate.mjs:115` an explicit `-s`, without routing it through droidctl. It is the
      release gate and it interleaves adb, CDP and microphone capture with timing that matters; an MCP hop
      would change what is being measured. The targeting fix is worth doing on its own.

## Phase 9 — Retire droidmind

**Last, and only after phases 7 and 8 have both run against the rig.**

- [ ] Remove the `droidmind` entry from `.mcp.json` and from the `serverNames` array at
      `scripts/setup-agentic-mcp.mjs:15`.
- [ ] Update the documentation that describes current procedure — `AGENTS.md:715-725` and
      `docs/agentic/prompt.md:3`. Ninety-two markdown files mention `droidmind`; the rest are historical
      records of runs that happened and are left alone.
- [ ] Update `c64scope/README.md`'s peer-server table, which names Droidmind as the app-lifecycle peer.

---

## Sequencing notes

- Phases 0 to 6 touch no existing file except `.mcp.json`, `package.json`,
  `scripts/setup-agentic-mcp.mjs` and `.gitignore`. They can land as one pull request that changes no
  behaviour.
- Phase 5 depends on phase 3's `ui_hierarchy` and on phase 3's `describe_target` for the screen
  rectangle. It cannot be pulled forward.
- Phase 7 is the first phase that can regress something. Run it against the rig before phase 8.
- Phase 9 is irreversible in the sense that reinstating `droidmind` means reinstating the `mcp<2` pin.
  Do not start it while any phase-7 or phase-8 item is open.

## Gates before every push

Run the `ship-gates` skill. Two traps in this repository have each turned a green pull request red: a
bare `tsc --noEmit` is not the typecheck CI runs, and a local build rewrites three files that must never
be committed. After any local build:
`git checkout -- THIRD_PARTY_NOTICES.md package-lock.json c64scope/package-lock.json`.

`npm run lint` — where the generator drift checks live — **is not run by any GitHub workflow**. If a
`droid:check` step is expected to gate anything, it needs its own CI job, modelled on the existing
`Notices | Generation + drift` job in `.github/workflows/android.yaml:90-136`.

Markdown is not covered by any Prettier npm script or CI job in this repository, and running Prettier
across `docs/` would rewrite tracked documents that were never formatted with it. Format only the files
this work adds: `npx prettier --write docs/plans/droidctl/*.md`.

## Definition of done

Copy this list into the final report and mark each item with the evidence for it — a command output, a
test name, a file path, a pull request number. An item without evidence is not done.

1. `npm run droid:check` is green, and coverage meets the thresholds in `droidctl/vitest.config.ts`.
2. All 25 tools in `spec.md` §8 are registered, and `tools/list` returns them.
3. The six targeting tests in `spec.md` §11.2 exist and pass, and the report names the mutation that was
   used to prove each one can fail.
4. The contract test walks the registry, and adding a zod field without the matching JSON Schema field
   turns it red.
5. `droidctl` appears in `.mcp.json` and in `scripts/setup-agentic-mcp.mjs`.
6. One CTA gate has run against the rig through droidctl, with the target named explicitly and the run id
   recorded.
7. `scripts/build-android-apks.mjs` no longer contains a single-device fallback, and
   `tools/hil/merge_gate.mjs` passes an explicit serial.
8. `droidmind` is absent from `.mcp.json`, and no code path in `c64scope/src/` references it.
9. The Sailfish stub is present, unit-tested, and its message names the checks from `spec.md` §14. No
   task, gate or remaining-work item anywhere names a Sailfish device as its venue.
