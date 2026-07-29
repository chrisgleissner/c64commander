---
name: ship-gates
description: >-
  Run the exact gates CI runs, in the right order, and stage a commit without sweeping in
  build churn. Use before every push on this repo, and when a CI check has gone red so the
  failure can be reproduced locally. Encodes two traps that have each turned a fully green
  PR red — bare `tsc --noEmit` is NOT the typecheck CI runs, and a local build rewrites
  three files that must never be committed.
---

# Pre-push gates

Run these before pushing. They are the same gates CI runs; skipping one costs a red check
and a round trip of several minutes.

## 1. Typecheck — use npm, never bare tsc

```bash
npm run typecheck
```

**This is the trap.** `npm run typecheck` is
`tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit` — two projects.
Bare `npx tsc --noEmit` uses the root config, accepts things the app project rejects, and
has turned an otherwise-green PR red. It happened on #326 with a `createElement` result
that failed only under `tsconfig.app.json`.

## 2. Lint and format

```bash
npx eslint .
npx prettier --check "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"
```

Do not pass `.py` or `.sh` paths to prettier — it cannot infer a parser and exits non-zero
on files it was never meant to format.

## 3. Tests

```bash
npx vitest run                                          # ~5 min, 800+ files
cd android && ./gradlew :app:testDebugUnitTest           # ~3 min
```

Run both in the background and wait; they are too slow to foreground.

## 4. Strip build churn before staging

A local build rewrites three files. Committing them has broken CI here before:

```bash
git checkout -- THIRD_PARTY_NOTICES.md package-lock.json c64scope/package-lock.json
```

**Never `git add -A`.** Add explicit paths only:

```bash
git add src/lib/foo.ts tests/unit/foo.test.ts
git status --short          # confirm nothing unexpected is staged
```

An automation on this repo auto-commits and pushes the working tree mid-session. If work
seems to have vanished, check `git log` and `git show` before redoing it.

## Reading a red check

The check named **"Web | Unit tests (coverage)"** runs a typecheck step *before* any test.
When it fails it is usually the typecheck, not a test — the name is misleading. Read the
step list rather than assuming:

```bash
gh pr checks 326 --json name,link,bucket
gh run view --job <id>                      # step list, shows which step has the X
gh run view --log-failed --job <id>         # only once the run has finished
```

`gh pr view --json commits` is **not** tip-ordered; use `git rev-parse origin/<branch>` to
know what is actually pushed.

## Watching CI to completion

Use a Monitor with an until-loop rather than polling, and make the filter cover failure as
well as success — a filter that greps only for passes stays silent through a crashloop:

```bash
prev=""
for i in $(seq 1 70); do
  s=$(gh pr checks <PR> --json name,bucket 2>/dev/null || echo '[]')
  cur=$(echo "$s" | jq -r '.[] | select(.bucket!="pending") | "\(.name): \(.bucket)"' | sort)
  comm -13 <(echo "$prev") <(echo "$cur") | grep -vE ": (pass|skipping)$" || true
  prev="$cur"
  echo "$s" | jq -e 'length > 0 and all(.bucket!="pending")' >/dev/null && {
    echo "COMPLETE: $(echo "$s" | jq -r '[.[].bucket]|group_by(.)|map("\(.[0])=\(length)")|join(" ")')"; break; }
  sleep 45
done
```

Merge-ready means `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, and zero `fail`
buckets — `skipping` is fine and expected (release/iOS-signing jobs).
