# Web Runtime Notes

## Verified runtime constraints
- Docker run used explicit hard limits: `512 MiB RAM`, `memorySwap=512 MiB`, `nanoCpus=2000000000`.
- Health endpoint responded successfully (`/healthz -> {"ok":true}`).
- Idle container memory stayed around `19.46-20.3 MiB` during smoke sample window.

## Build/runtime observations
- Main web bundle: `dist/assets/index-*.js` around `1.22 MB` minified (`~376 KB gzip`).
- Large wasm payload present: `7zz.wasm` around `1.65 MB`.
- Vite warned for chunks over 1200 kB.
- Docker runtime image uses Node 24 (`node:24-trixie-slim`) and does not set explicit `NODE_OPTIONS=--max-old-space-size=...`.

## Limits of this measurement
- Docker runtime sample captured idle steady-state only; it did not include long-session interaction churn or HVSC-heavy workflows.
- No swap-thrash or OOM event was observed in this run.
