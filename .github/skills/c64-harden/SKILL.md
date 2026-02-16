---
name: c64-harden
description: Production hardening workflow for C64 Commander covering CI integrity, Docker images, Node runtime, artifact consistency, and release stability.
argument-hint: (optional) scope such as docker, ci, node, artifacts
user-invokable: true
disable-model-invocation: true
---

# Skill: C64 Production Hardening

## Purpose

Ensure the repository is production-grade across:

- CI
- Node runtime
- Docker images
- Multi-arch support
- Artifact consistency
- Release tagging

---

## Execution Workflow

### Step 1 - CI Integrity

- Validate all workflows execute successfully.
- Ensure coverage gates pass.
- Ensure no skipped jobs.
- Ensure no silent failures.

---

### Step 2 - Node and Dependency Integrity

- Confirm Node version matches package.json engines.
- Validate Docker base image alignment.
- Check for deprecated or vulnerable dependencies.
- Run full test suite under declared Node version.

---

### Step 3 - Docker Hardening

If Docker is in scope:

- Validate multi-arch support.
- Confirm buildx configuration.
- Confirm supported platforms:
  - Linux amd64
  - Linux arm64
- Avoid excessive image variants.
- Confirm version tag alignment with Git tag.

---

### Step 4 - Artifact Consistency

Validate alignment across:

- Git tag
- package.json version
- Android versionCode/versionName
- iOS version
- Docker tag
- GitHub release

All must match.

---

### Step 5 - Release Validation

- Confirm tagged commit matches intended source.
- Confirm build reproducibility.
- Confirm no untracked changes.

---

## Constraints

- Do not introduce breaking changes.
- Do not rewrite git history.
- Avoid maintenance explosion.
- Prefer minimal, robust configuration.

---

## Completion Criteria

- CI green.
- Coverage intact.
- Docker builds reproducible.
- Multi-arch validated.
- Version alignment verified.
- Clean working tree.
