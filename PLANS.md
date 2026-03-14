# Production Hardening Audit Plan

This document defines the audit plan only. It does not contain audit findings or a review report.

## Phase 1: Repository Inventory

- [ ] Catalog top-level apps, packages, services, scripts, and generated artifact directories.
- [ ] Identify runtime entry points for web, Android, iOS, Playwright, agents, and supporting services.
- [ ] Map critical source directories to responsibilities across UI, hooks, API, native bridges, and diagnostics.
- [ ] List build, test, packaging, and release commands from package scripts and helper scripts.
- [ ] Record external systems the repository depends on, including C64 Ultimate REST, FTP, Docker, Android, iOS, and GitHub Actions.

## Phase 2: Documentation Audit

- [ ] Review README, docs, and doc content for setup accuracy, production boundaries, and operational clarity.
- [ ] Check that platform-specific instructions match the current Android, iOS, and web deployment flows.
- [ ] Verify that diagnostics, security, networking, and troubleshooting documentation reflects current behavior.
- [ ] Identify undocumented operational assumptions, manual steps, and recovery procedures.
- [ ] Note stale, duplicated, or conflicting guidance between README, doc, docs, and in-repo prompts.

## Phase 3: Architecture Reconstruction

- [ ] Reconstruct the high-level architecture from UI, hook, service, native bridge, and backend-facing modules.
- [ ] Trace state ownership for connection status, configuration state, diagnostics state, and playback state.
- [ ] Identify boundaries between React UI, domain logic, transport adapters, native integrations, and persistence.
- [ ] Map how feature flags, app config, and environment-specific behavior are introduced and consumed.
- [ ] Produce a dependency sketch of critical modules whose failure would block core product flows.

## Phase 4: Runtime Interaction Tracing

- [ ] Trace startup flow from app launch to first usable screen across supported platforms.
- [ ] Trace user actions that write device configuration from UI intent to transport request.
- [ ] Trace async event propagation for polling, retries, throttling, and UI refresh paths.
- [ ] Trace diagnostics and logging emission paths from runtime events to stored or displayed evidence.
- [ ] Trace failure handling paths for timeouts, offline states, malformed responses, and partial device availability.

## Phase 5: Device Communication

- [ ] Inventory all REST, FTP, and any other device-facing communication paths.
- [ ] Verify request construction, response parsing, schema assumptions, and protocol-specific fallbacks.
- [ ] Check timeout, retry, backoff, and cancellation behavior for device operations.
- [ ] Identify write operations that could leave device state partially applied or inconsistent.
- [ ] Review handling of hostname, IP, credentials, and local network assumptions in production scenarios.

## Phase 6: Connection Management

- [ ] Audit connection lifecycle handling for cold start, reconnect, disconnect, and device-switch scenarios.
- [ ] Review polling cadence, concurrent request coordination, and stale request suppression.
- [ ] Check UI signaling for connection health, degraded modes, and recovery guidance.
- [ ] Verify how demo mode, cached state, and live device state are separated to avoid cross-contamination.
- [ ] Identify race conditions between connection updates, config edits, and background refresh tasks.

## Phase 7: Diagnostics

- [ ] Inventory diagnostics surfaces, logs, traces, captures, and exported evidence paths.
- [ ] Review diagnostic action safety, privacy impact, and failure visibility.
- [ ] Check whether diagnostic tools remain usable when the device or network is degraded.
- [ ] Verify that errors are logged or surfaced with enough context for production triage.
- [ ] Identify gaps in observability for user-reported failures that cannot currently be reproduced locally.

## Phase 8: Test Coverage

- [ ] Inventory unit, integration, Playwright, Android, and agent test suites and their intended responsibilities.
- [ ] Map high-risk product flows to existing regression coverage and identify blind spots.
- [ ] Review coverage thresholds, current branch coverage posture, and enforcement points in local and CI workflows.
- [ ] Check whether device communication, failure handling, and recovery paths have deterministic tests.
- [ ] Identify flaky, slow, environment-coupled, or redundant tests that weaken release confidence.

## Phase 9: CI/CD

- [ ] Review GitHub Actions and local helper scripts for build, test, release, and artifact publication flow.
- [ ] Verify branch, tag, and release assumptions against documented release policy.
- [ ] Check which validations gate merges versus which run only on release or platform-specific workflows.
- [ ] Audit artifact retention, provenance, reproducibility, and failure reporting in CI.
- [ ] Identify missing quality gates for formatting, security-sensitive changes, coverage, and platform packaging.

## Phase 10: Platform Integrations

- [ ] Audit Capacitor, Android, iOS, web, and Docker integration points for configuration drift.
- [ ] Review native bridge contracts and error propagation between TypeScript and platform code.
- [ ] Check file-system, storage, permission, and media access behavior across supported platforms.
- [ ] Verify web deployment assumptions for LAN hosting, port exposure, and persisted config storage.
- [ ] Identify platform-specific production risks that are not covered by shared logic tests.

## Phase 11: Security and Reliability

- [ ] Review authentication, password handling, local storage, and secret exposure risks.
- [ ] Inspect network trust assumptions, insecure transport exposure, and boundary protections for LAN deployment.
- [ ] Audit exception handling, retry loops, fallback behavior, and crash-prone code paths.
- [ ] Identify operations lacking idempotency, confirmation, rollback, or safe failure behavior.
- [ ] Review third-party dependencies, patch files, and update practices for production maintenance risk.

## Phase 12: Production Risk

- [ ] Rank the most critical user-facing and operational risks by severity, likelihood, and detectability.
- [ ] Identify single points of failure across runtime, build, release, and device interaction paths.
- [ ] Define which risks are acceptable, which require mitigation before release, and which need monitoring only.
- [ ] Prepare a remediation backlog structure grouped by immediate, short-term, and longer-term hardening work.
- [ ] Define the evidence package required for a final production hardening report after the audit is executed.
