# ORT Compliance Integration Plan

## Scope

Implement full OSS Review Toolkit (ORT) compliance automation and app integration for third-party notices, including CI enforcement and Settings → About → Open Source Licenses.

## Execution Status

- [x] Replace this plan file with ORT integration plan
- [x] Add ORT repository configuration and evaluator policy rules
- [x] Add deterministic ORT scripts for pipeline, notice generation, sync, and drift checks
- [x] Add Settings → About → Open Source Licenses route and page
- [x] Bundle notices via public assets for web + Capacitor targets
- [x] Add CI workflow to enforce ORT pipeline and notice drift checks
- [x] Regenerate `THIRD_PARTY_NOTICES` from ORT report output
- [ ] Run and document required validations (`npm run test`, `npm run build`, `npm run test:coverage`, `./build`)

## Commands To Validate

```bash
npm run ort:notices
npm run ort:check-drift
npm run test
npm run build
npm run test:coverage
./build
```
