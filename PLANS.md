# Telnet Integration Research & Design

Status: COMPLETE
Date: 2026-03-24
Classification: DOC_ONLY

## Task Summary

Deep research and design pass for Telnet-based control support for C64 Ultimate action-menu functionality not exposed via REST. Produces an implementation-ready specification at `doc/c64/telnet/telnet-integration-spec.md`.

## TODO

- [x] Read required documents (architecture.md, openapi.yaml, telnet-spec.md, telnet-action-walkthrough.md)
- [x] Inspect C64 Commander REST client implementation and concurrency model
- [x] Inspect C64 Commander FTP client implementation and concurrency model
- [x] Inspect request scheduling, queueing, retries, timeouts, cancellation
- [x] Inspect device action models and diagnostics
- [x] Inspect Home page UI and existing reset/reboot controls
- [x] Inspect existing mocks and test infrastructure
- [x] Inspect 1541 Ultimate firmware Telnet server implementation
- [x] Inspect firmware remote-control / console / terminal handling
- [x] Inspect firmware shared locks, event loops, UI threads, command dispatchers
- [x] Determine if concurrent REST/FTP/Telnet is safe from firmware evidence
- [x] Design Telnet transport architecture
- [x] Design scheduling / serialization model
- [x] Design Telnet client
- [x] Design Telnet parser / navigator
- [x] Design Telnet mock
- [x] Design action abstraction and capability mapping
- [x] Design UI placement
- [x] Define platform support strategy (Android, iOS, web)
- [x] Write telnet-integration-spec.md
- [x] Final review for concision and implementation readiness
- [x] Finalize WORKLOG.md
- [x] Finalize PLANS.md

## Deliverables

- `doc/c64/telnet/telnet-integration-spec.md` — Implementation-ready specification
- `WORKLOG.md` — Investigation history with evidence sources
- `PLANS.md` — This file
