---
name: repo-inventory
description: Use when building a repository inventory for C64 Commander, including subsystem boundaries, runtime entry points, and major module responsibilities.
argument-hint: (optional) depth such as quick, medium, or deep
user-invocable: true
disable-model-invocation: true
---

# Repo Inventory Skill

## Purpose

Produce a structured map of the repository before deeper review, refactoring, or risk analysis.

## Workflow

1. Traverse the repository surface relevant to the task.
2. Identify top-level applications, packages, scripts, and generated artifact areas.
3. Map directories to functional components and runtime boundaries.
4. Call out ownership splits between UI, hooks, services, native bridges, tests, and tooling.
5. Highlight hotspots that deserve deeper inspection.

## Core Steps

1. Traverse entire repository
2. Identify subsystems
3. Map directories to functional components

Output:

Repository inventory including:

- subsystem grouping
- runtime boundaries
- module responsibilities
- notable risk or complexity hotspots
