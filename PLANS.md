# Production Hardening Audit Plan

This document defines the audit plan only. It does not contain audit findings or a review report.

## Phase 1: Repository Inventory

- [x] Catalog top-level apps, packages, services, scripts, and generated artifact directories.
- [x] Identify runtime entry points for web, Android, iOS, Playwright, agents, and supporting services.
- [x] Map critical source directories to responsibilities across UI, hooks, API, native bridges, and diagnostics.
- [x] List build, test, packaging, and release commands from package scripts and helper scripts.
- [x] Record external systems the repository depends on, including C64 Ultimate REST, FTP, Docker, Android, iOS, and GitHub Actions.

## Phase 2: Documentation Audit

- [x] Review README, docs, and doc content for setup accuracy, production boundaries, and operational clarity.
- [x] Check that platform-specific instructions match the current Android, iOS, and web deployment flows.
- [x] Verify that diagnostics, security, networking, and troubleshooting documentation reflects current behavior.
- [x] Identify undocumented operational assumptions, manual steps, and recovery procedures.
- [x] Note stale, duplicated, or conflicting guidance between README, doc, docs, and in-repo prompts.

## Phase 3: Architecture Reconstruction

- [x] Reconstruct the high-level architecture from UI, hook, service, native bridge, and backend-facing modules.
- [x] Trace state ownership for connection status, configuration state, diagnostics state, and playback state.
- [x] Identify boundaries between React UI, domain logic, transport adapters, native integrations, and persistence.
- [x] Map how feature flags, app config, and environment-specific behavior are introduced and consumed.
- [x] Produce a dependency sketch of critical modules whose failure would block core product flows.

## Phase 4: Runtime Interaction Tracing

- [x] Trace startup flow from app launch to first usable screen across supported platforms.
- [x] Trace user actions that write device configuration from UI intent to transport request.
- [x] Trace async event propagation for polling, retries, throttling, and UI refresh paths.
- [x] Trace diagnostics and logging emission paths from runtime events to stored or displayed evidence.
- [x] Trace failure handling paths for timeouts, offline states, malformed responses, and partial device availability.

## Phase 5: Device Communication

- [x] Inventory all REST, FTP, and any other device-facing communication paths.
- [x] Verify request construction, response parsing, schema assumptions, and protocol-specific fallbacks.
- [x] Check timeout, retry, backoff, and cancellation behavior for device operations.
- [x] Identify write operations that could leave device state partially applied or inconsistent.
- [x] Review handling of hostname, IP, credentials, and local network assumptions in production scenarios.

## Phase 6: Connection Management

- [x] Audit connection lifecycle handling for cold start, reconnect, disconnect, and device-switch scenarios.
- [x] Review polling cadence, concurrent request coordination, and stale request suppression.
- [x] Check UI signaling for connection health, degraded modes, and recovery guidance.
- [x] Verify how demo mode, cached state, and live device state are separated to avoid cross-contamination.
- [x] Identify race conditions between connection updates, config edits, and background refresh tasks.

## Phase 7: Diagnostics

- [x] Inventory diagnostics surfaces, logs, traces, captures, and exported evidence paths.
- [x] Review diagnostic action safety, privacy impact, and failure visibility.
- [x] Check whether diagnostic tools remain usable when the device or network is degraded.
- [x] Verify that errors are logged or surfaced with enough context for production triage.
- [x] Identify gaps in observability for user-reported failures that cannot currently be reproduced locally.

## Phase 8: Test Coverage

- [x] Inventory unit, integration, Playwright, Android, and agent test suites and their intended responsibilities.
- [x] Map high-risk product flows to existing regression coverage and identify blind spots.
- [x] Review coverage thresholds, current branch coverage posture, and enforcement points in local and CI workflows.
- [x] Check whether device communication, failure handling, and recovery paths have deterministic tests.
- [x] Identify flaky, slow, environment-coupled, or redundant tests that weaken release confidence.

## Phase 9: CI/CD

- [x] Review GitHub Actions and local helper scripts for build, test, release, and artifact publication flow.
- [x] Verify branch, tag, and release assumptions against documented release policy.
- [x] Check which validations gate merges versus which run only on release or platform-specific workflows.
- [x] Audit artifact retention, provenance, reproducibility, and failure reporting in CI.
- [x] Identify missing quality gates for formatting, security-sensitive changes, coverage, and platform packaging.

## Phase 10: Platform Integrations

- [x] Audit Capacitor, Android, iOS, web, and Docker integration points for configuration drift.
- [x] Review native bridge contracts and error propagation between TypeScript and platform code.
- [x] Check file-system, storage, permission, and media access behavior across supported platforms.
- [x] Verify web deployment assumptions for LAN hosting, port exposure, and persisted config storage.
- [x] Identify platform-specific production risks that are not covered by shared logic tests.

## Phase 11: Security and Reliability

- [x] Review authentication, password handling, local storage, and secret exposure risks.
- [x] Inspect network trust assumptions, insecure transport exposure, and boundary protections for LAN deployment.
- [x] Audit exception handling, retry loops, fallback behavior, and crash-prone code paths.
- [x] Identify operations lacking idempotency, confirmation, rollback, or safe failure behavior.
- [x] Review third-party dependencies, patch files, and update practices for production maintenance risk.

## Phase 12: Production Risk

- [x] Rank the most critical user-facing and operational risks by severity, likelihood, and detectability.
- [x] Identify single points of failure across runtime, build, release, and device interaction paths.
- [x] Define which risks are acceptable, which require mitigation before release, and which need monitoring only.
- [x] Prepare a remediation backlog structure grouped by immediate, short-term, and longer-term hardening work.
- [x] Define the evidence package required for a final production hardening report after the audit is executed.

## Display Profiles Readiness Analysis

- [x] Classify the task as `DOC_ONLY` and limit validation scope to documentation accuracy and consistency.
- [x] Review the display-profile specification, UX guidelines, UX interactions inventory, README, AGENTS, and relevant material under `doc/`, `doc/c64/`, `doc/diagnostics/`, and `doc/testing/`.
- [x] Audit the current page shells, shared components, modal primitives, screenshot generation flow, and Playwright layout coverage for display-profile readiness.
- [x] Produce `doc/plans/display-profiles/display-profiles-gap-analysis.md`.
- [x] Produce `doc/plans/display-profiles/display-profiles-implementation-plan.md`.
- [x] Produce and maintain `doc/plans/display-profiles/work-log.md`.
