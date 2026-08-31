# droidctl — kickoff prompt

Give this to the implementing agent verbatim.

---

## Your task

Build `droidctl`, a new MCP server in `/home/chris/dev/c64/c64commander`, following
`docs/plans/droidctl/spec.md` and `docs/plans/droidctl/plan.md`. Read both in full before writing any
code.

`droidctl` deploys and drives the C64 Commander Android app on a device under test. It replaces the
third-party `droidmind` MCP server, which declares `mcp[cli]>=1.25.0` with no upper bound and stopped
starting when the MCP Python SDK published a breaking 2.x. The `--with mcp<2` argument now in
`.mcp.json` is a stopgap pinning somebody else's dependency from the outside.

## Read first, in this order

1. `docs/plans/droidctl/spec.md` — the design. §6 (target selection safety), §8 (the tool surface),
   §9 (assertion semantics) and §14 (the open questions) are binding. Appendix A is the inventory the
   tool surface was derived from; do not add a tool that is not in it.
2. `docs/plans/droidctl/plan.md` — phases 0 to 9, with a `file:line` reference for every source of a
   behaviour you are meant to copy.
3. `c64scope/src/server.ts`, `c64scope/src/tools/registry.ts`, `c64scope/src/tools/types.ts`,
   `c64scope/src/types.ts` — the existing in-repo MCP server. `droidctl` copies its structure closely
   enough that a reader of one can read the other.
4. `c64scope/src/validation/droidmindClient.ts` — the behaviour being replaced, including the two
   workarounds that move into the server.
5. `AGENTS.md`, in particular lines 999-1021.

## What you are building

Six tool modules and 25 tools over a transport abstraction with two backends: `adb` for the Pixel 4,
emulators and Waydroid containers, and `sailfish` for a Sailfish OS device running the same Android
build on Jolla's Android compatibility layer. Both sit behind one interface, so a caller does not branch
on transport.

The surface is derived from what this repository already does with `adb` — 39 files, about 242
invocation lines — not from what an Android automation framework could offer.

## The five rules that must not be broken

1. **Every tool takes an explicit target and refuses to guess.** No default target, no "the only
   connected device" fallback, no prefix that resolves to a single candidate. Ambiguity is an error
   listing the candidates. This is not a preference: while a CI Android emulator was running on this
   machine, a bare `adb` command could have hit the emulator part-way through an in-flight release build.
   `scripts/build-android-apks.mjs:248` still contains `if (serials.length === 1) return serials[0]`
   feeding a step list that includes `uninstall` and `pm clear`. Enforce this with the tests in spec
   §11.2, not with review.
2. **Every tool that names an application takes an explicit package.** The repository builds two
   application ids and both can be installed at once, and both open a WebView DevTools socket — picking
   the first one attaches to the wrong app, and the other edition may still hold an `AudioTrack` and
   corrupt an audio measurement.
3. **Visibility is decided from the UI hierarchy dump, never from image comparison**, and
   `requireOnScreen` defaults to true. `c64scope/src/cta/uiHelpers.ts:27` treats any non-degenerate
   bounds as visible today, so a node scrolled far off the viewport counts as visible — that is the gap
   spec §9.2 closes. A failed assertion returns `passed: false` with evidence, never an exception.
4. **Do not gate anything on a Sailfish device.** No such device is on this bench and none can be
   obtained. `AGENTS.md:1004-1015` says an item whose venue is that handset is not blocked but
   unrunnable, and that such items have been repeatedly re-created across sessions. Build the transport
   interface and a stub that returns `transport_unavailable` with the spec §14 probe procedure in its
   message. Do not write a task, gate or remaining-work item that needs the hardware.
5. **Do not touch hardware without being asked to.** Enumerating targets and installing to the Pixel 4
   are real actions on a shared bench. The audio harnesses play sound in somebody's room, and the media
   volume must never exceed 10 of 25 (`AGENTS.md:165`).

## Start here

Phase 0 and phase 1 of `plan.md` — the package skeleton and the server shell. Both are mechanical copies
of the `c64scope/` equivalents. Two items in them are easy to skip and expensive to skip:

- Commit `droidctl/package-lock.json` and pin `@modelcontextprotocol/sdk` with a caret. An unbounded
  dependency range is the exact failure this work exists to fix; repeating it would be absurd.
- Add `droidctl` to the `serverNames` array at `scripts/setup-agentic-mcp.mjs:15` as well as to
  `.mcp.json`. That script is the single writer of MCP configuration across three files, and a server
  missing from it is silently dropped the next time the setup runs.

Then write **phase 2's targeting tests before phase 2's transport registry**, so the registry is checked
by them rather than the other way round. Prove they can fail by temporarily pasting the
`serials.length === 1` fallback into the registry and confirming the ambiguity and stale-id tests go red.

**Phase 3 is the first phase that delivers something usable.** Phases 0 to 2 produce a server that
enumerates a device and nothing else.

## Traps in this repository that have each cost a red CI run

- **Never run `npm install` and never run `./build`.** Both rewrite `package-lock.json` and prune
  `@emnapi`, which turns roughly ten CI jobs red. After any local build:
  `git checkout -- THIRD_PARTY_NOTICES.md package-lock.json c64scope/package-lock.json`.
- **`npm run typecheck`, never bare `tsc --noEmit`.** The npm script runs two projects; bare `tsc` uses
  the root config, accepts what `tsconfig.app.json` rejects, and has turned a green pull request red.
- **Never `git add -A`.** Stage explicit paths and read `git status --short` before every commit. An
  automation on this repository auto-commits and pushes mid-session; check `git log` before assuming work
  was lost.
- **Markdown is not Prettier-formatted in this repository.** No npm script and no CI job covers it, and
  running Prettier across `docs/` would rewrite tracked documents that were never formatted with it.
  Format only files this work adds.
- **`npm run lint` runs in no GitHub workflow.** If a `droid:check` step is meant to gate anything, it
  needs its own CI job, modelled on `Notices | Generation + drift` in
  `.github/workflows/android.yaml:90-136`.
- **A leftover `wm size` override** from an earlier session fails the HIL input and clarity stages with
  no code fault at all. `droid_target.describe_target` reports it for exactly this reason.
- **A hidden or locked WebView reads exactly like an app hang.** Chromium suspends timers in a hidden
  page, so debounces never fire and `Filesystem.readFile` promises never settle, while `Runtime.evaluate`
  keeps working. `tools/hil/README.md:19-40` has the full account and the `wm dismiss-keyguard` fix.
- **The HIL merge gate fails on `main` too.** Baseline the base commit with `--only <stage>` before
  concluding your branch caused anything.

## Constraints on what you write

- **Commit messages and the pull request body must not name a build variant, a handset, a partner or a
  target operating system.** The plan documents may name hardware; the commits and the pull request must
  describe the work as tooling.
- **The pull request description** follows the repository's rules: plain engineering language, previous
  behaviour and the defect stated separately from the implemented change and from how it was verified,
  no metaphors, no marketing, and no claiming an implementation is "clean" or "correct" without naming
  the property that makes it so.
- **No comment longer than five lines.** Compress a long why-comment; do not drop it.
- **Before amending a failing test, ask whether the change makes sense to a user.** If it does not, the
  production code is wrong, not the test.

## When you are unsure

The spec's §6 and §9 decisions were made against specific defects in this repository and are not yours
to revisit. If implementation shows one of them is unworkable, stop and say so with the concrete
evidence rather than quietly picking a different design. In particular, if the targeting tests go red,
find the code path that guessed a target. Do not add an exemption; an exemption makes those tests
worthless.

Spec §14 is a list of honest unknowns about the Sailfish transport, several of which are unresolved
because the vendor's own pages could not be reached. Do not resolve one by inventing an API. If you
cannot establish something, leave it in §14 and say so.

## Done means

The nine checks in `plan.md` under "Definition of done", each satisfied and demonstrated — not asserted.
For each of the six targeting tests, name the mutation you used to prove it can fail.
