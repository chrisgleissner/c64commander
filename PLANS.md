# Container Image Optimization Execution Contract

Last updated: 2026-02-16
Owner: Copilot coding agent
Branch: test/improve-coverage
Target image: ghcr.io/chrisgleissner/c64commander:latest (baseline)
Temporary artifact root: .tmp/container-image-opt/

## Objective

Harden and optimize the production multi-arch Docker image (linux/amd64 + linux/arm64) while preserving runtime behavior, API semantics, required assets, entrypoint behavior, and multi-arch manifest character.

## Hard constraints

- Preserve runtime behavior and required runtime assets.
- Preserve multi-arch character for published main tag.
- No runtime-required file removal without verification evidence.
- Reproducible build behavior (lockfile-based installs, deterministic Docker steps).
- Avoid tag churn; only use `-rcN` fallback if A/B/C fail.

## Baseline evidence (mandatory)

Commands executed:

- `dive ghcr.io/chrisgleissner/c64commander:latest --json .tmp/container-image-opt/dive-report.baseline.json`
- `CI=true dive ghcr.io/chrisgleissner/c64commander:latest | tee .tmp/container-image-opt/dive-ci.baseline.txt`
- `docker history --no-trunc ghcr.io/chrisgleissner/c64commander:latest > .tmp/container-image-opt/docker-history.baseline.txt`
- `docker image inspect ghcr.io/chrisgleissner/c64commander:latest > .tmp/container-image-opt/docker-inspect.baseline.json`
- `docker run --rm ghcr.io/chrisgleissner/c64commander:latest sh -c "find / -xdev -type f 2>/dev/null | wc -l" > .tmp/container-image-opt/filecount.baseline.txt`

Baseline headline metrics:

- Dive efficiency score: `0.7423813825286085`
- Dive inefficient/wasted bytes: `255097665` bytes
- Dive image size bytes: `498826495` bytes
- File count: `23251`
- Layers: `11`

Per-layer baseline sizes:

1. index=2 sizeBytes=141655540
2. index=7 sizeBytes=135079646
3. index=10 sizeBytes=124832265
4. index=0 sizeBytes=78613569
5. index=8 sizeBytes=10933042
6. index=3 sizeBytes=7241529
7. index=6 sizeBytes=434982
8. index=9 sizeBytes=26636
9. index=1 sizeBytes=8898
10. index=4 sizeBytes=388
11. index=5 sizeBytes=0

Top 20 largest layers:

1. index=2 sizeBytes=141655540 command=`RUN ... node base setup ...`
2. index=7 sizeBytes=135079646 command=`RUN npm ci --omit=dev --ignore-scripts`
3. index=10 sizeBytes=124832265 command=`RUN mkdir -p /config && chown -R node:node /app /config`
4. index=0 sizeBytes=78613569 command=`debian trixie base layer`
5. index=8 sizeBytes=10933042 command=`COPY /app/dist ./dist`
6. index=3 sizeBytes=7241529 command=`RUN apt install ...`
7. index=6 sizeBytes=434982 command=`COPY package*.json ./`
8. index=9 sizeBytes=26636 command=`COPY /app/web/server/dist ./web/server/dist`
9. index=1 sizeBytes=8898 command=`create node user`
10. index=4 sizeBytes=388 command=`COPY docker-entrypoint.sh`
11. index=5 sizeBytes=0 command=`WORKDIR /app`

Top 20 directories by cumulative size:

1. /app — 499329060
2. /app/node_modules — 453750420
3. /app/node_modules/lucide-react — 114001200
4. /app/node_modules/lucide-react/dist — 104551740
5. /app/node_modules/date-fns — 88612808
6. /app/node_modules/date-fns/locale — 68885584
7. /app/dist — 43732168
8. /app/node_modules/lucide-react/dist/umd — 38068424
9. /app/dist/assets — 34528568
10. /app/node_modules/lucide-react/dist/esm — 23368740
11. /app/node_modules/tailwindcss — 22937956
12. /app/node_modules/lucide-react/dist/esm/icons — 22500728
13. /app/node_modules/lucide-react/dist/cjs — 20325916
14. /app/node_modules/recharts — 18600232
15. /app/node_modules/react-dom — 18054196
16. /app/node_modules/tailwindcss/peers — 18018344
17. /app/node_modules/framer-motion — 17527308
18. /app/node_modules/framer-motion/dist — 17475004
19. /var — 16039732
20. /app/node_modules/zod — 14376784

Duplicate-file evidence across layers (top):

- `/app/dist/assets/index-CkGRWi98.js.map` (count 2, 10154048 bytes)
- `/app/node_modules/tailwindcss/peers/index.js` (count 2, 9009172 bytes)
- `/app/node_modules/lucide-react/dist/umd/lucide-react.js.map` (count 2, 8792922 bytes)
- `/app/node_modules/lucide-react/dist/cjs/lucide-react.js.map` (count 2, 8655854 bytes)
- `/app/node_modules/lucide-react/dist/umd/lucide-react.min.js.map` (count 2, 7629264 bytes)

Added-then-removed evidence:

- No overlay whiteout paths observed in baseline sample; inefficiency is dominated by duplicated files across layers (notably `chown -R node:node /app ...` creating full-copy metadata churn).

Cache/build-leftover indicators (baseline):

- source maps: 2679 paths
- tests-related files: 320 paths
- apt lists: 0
- apt archives: 0
- npm/yarn/pnpm caches: 0
- VCS metadata: 0

## Build strategy decision tree status

A. Local buildx multi-arch feasibility

- `docker buildx use multiarch`
- `docker run --privileged --rm tonistiigi/binfmt --install all`
- `docker buildx build --platform linux/amd64,linux/arm64 -f web/Dockerfile -t c64commander:opt-test-multi --load .`
- Result: **SUCCESS** (local multi-arch build feasible)

B. Per-arch local fallback

- Not needed because A succeeded.

C. CI-driven multi-arch assembly fallback

- Not required.

D. Tagging fallback (`-rcN`)

- Not required.

## Identified inefficiencies and hypotheses

1. `RUN chown -R node:node /app /config` in runtime stage creates a large duplicate layer (~124.8 MB).
2. Runtime image carries many source maps and docs from production dependencies.
3. Existing `.dockerignore` can be tightened to prevent accidental context bloat from analysis artifacts.
4. Dive gating is not currently integrated for web image regression prevention.

## Risk register

- R1: Ownership change optimization could break runtime write access. Mitigation: verify startup + health endpoint + writes to `/config`.
- R2: Aggressive pruning could remove runtime-required files. Mitigation: apply minimal safe change first (ownership/layering), verify behavior.
- R3: CI dive thresholds may be too strict/lenient. Mitigation: derive from post-optimization measured baseline and document rationale.

## Stepwise implementation plan

1. Replace recursive `chown -R` with ownership-at-copy and targeted `/config` ownership.
2. Rebuild multi-arch locally and run smoke validation.
3. Re-run dive/history/inspect/filecount on optimized image and record deltas.
4. Add `.dive-ci` thresholds derived from improved baseline.
5. Integrate `CI=true dive` gate into web CI image workflow.
6. Run required repo validations (`npm run lint`, `npm run test`, `npm run build`, `./build`).
7. Verify multi-arch manifest/index output for built image and published baseline.
8. Commit all changes.

## Verification plan

- Image analysis:
  - `dive <optimized-image> --json .tmp/container-image-opt/dive-report.after.stepX.json`
  - `CI=true dive <optimized-image> --ci-config .dive-ci`
  - `docker history --no-trunc <optimized-image>`
  - `docker image inspect <optimized-image>`
  - `docker run --rm <optimized-image> sh -c "find / -xdev -type f 2>/dev/null | wc -l"`
- Runtime validation:
  - container startup, health endpoint `GET /healthz`
  - no startup errors in logs
  - required assets present (`/app/dist`, `/app/web/server/dist`)
- Multi-arch integrity:
  - `docker buildx imagetools inspect <image-ref>`

## Progress log

- 2026-02-16: Baseline analysis completed and stored under `.tmp/container-image-opt/`.
- 2026-02-16: Decision-tree step A validated (local multi-arch build works).
- 2026-02-16: Fuzz CI checkout updated to `fetch-depth: 0`.
- 2026-02-16: Build metadata extraction noise reduced in `vite.config.ts` by suppressing expected no-tag `git describe` failures.
