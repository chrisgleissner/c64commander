# review-15

## Purpose

`review-15` packages two follow-on artifacts for C64 Commander hardening work:

- the review contract and completed repository-derived review
- an Android-first implementation continuation prompt for closing the remaining production-readiness gaps

An in-progress review already exists at `docs/research/review-15/review-15.md`. The current handoff is continuation-oriented: the next LLM must continue and repair that file in place rather than starting a fresh review from scratch.

## Scope Boundaries

- In scope: repository feature discovery, implementation mapping, test mapping, screenshot-backed UI coverage, Android/iOS/Web platform modeling, and hardware-aware validation requirements.
- In scope: screenshots under `docs/img/app/`, existing coverage catalogs under `docs/testing/agentic-tests/`, native code under `android/` and `ios/`, and web runtime code under `web/server/`.
- Out of scope for the review contract: code changes, test execution, screenshot regeneration, and release decisions.
- In scope for the continuation prompt: implementing and validating the outstanding production-readiness backlog, with Android as the primary target.

## Production Release Relationship

This package is a pre-review handoff for release hardening. It is intended to drive an exhaustive gap analysis before production sign-off, with Android as the primary target and iOS/Web modeled explicitly as secondary targets.

## Devices

- Android handset: Pixel 4 via ADB when available
- Preferred real hardware target: Ultimate 64 / `u64`
- Fallback real hardware target: C64 Ultimate / `c64u`
- iOS physical execution: CI or macOS-only; still model iOS behavior even when local physical execution is unavailable

## How To Execute

1. For review continuation, open `REVIEW_PROMPT.md`, `FEATURE_MODEL.md`, and `review-15.md`.
2. Treat `review-15.md` as provisional prior work and continue it in place.
3. Require the downstream LLM to follow the review schema and output format exactly, with no skipped traversal steps, no omitted feature families, and no unverified carry-forward claims.
4. For implementation follow-up after the review, open `PRODUCTION_READINESS_CONTINUATION_PROMPT.md` together with `review-15.md`.
5. Use that continuation prompt to close the remaining Android-first backlog, then the iOS and web follow-up items.

## Files

- `FEATURE_MODEL.md`: normalized feature schema used by the review
- `REVIEW_PROMPT.md`: deterministic review contract
- `review-15.md`: current repository-derived hardening review
- `HANDOVER_PROMPT.md`: current-state handoff prompt for the remaining external validation work
- `PRODUCTION_READINESS_CONTINUATION_PROMPT.md`: Android-first implementation follow-up prompt derived from the review backlog
