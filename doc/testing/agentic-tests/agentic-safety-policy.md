# Agentic Safety Policy

## Purpose

This file bounds autonomous mutation of the app and the attached hardware during physical runs.

## Action Classes

| Class | Meaning | Examples |
| --- | --- | --- |
| Read-only | No persistent product or device mutation | docs, licenses, route discovery |
| Guarded mutation | Expected mutation with bounded cleanup | playlist edits, mount/eject, theme changes |
| Destructive mutation | Can erase state, interrupt hardware, or require recovery | RAM clear, flash reset, delete, power off |
| Prohibited | Not allowed in autonomous product runs | user-data deletion outside test namespace, uncontrolled loops |

## Global Rules

1. Use the app path first. Do not use direct tools to bypass the behavior under test.
2. Capture a baseline before destructive actions.
3. Never repeat destructive actions in a blind retry loop.
4. Stop once a cleanup path is no longer deterministic.

## Mutation Budgets

| Action family | Class | Max per case | Required guard | Cleanup requirement |
| --- | --- | --- | --- | --- |
| Reset or reboot | Destructive | 1 | Explicit case need and pre-action baseline | Confirm device returns to a known connected state |
| Power off | Destructive | 1 and only in dedicated power cases | Explicit approval in case metadata | Dedicated recovery procedure required |
| RAM save/load | Destructive | 1 save and 1 load | Test-owned dump location | Remove or isolate generated dumps |
| Reboot and clear RAM | Destructive | 1 | Dedicated case only | Recovery must prove stable post-clear state |
| Flash config save/load/reset | Destructive | 1 each | Test-owned config target and rollback path | Restore baseline config before leaving case |
| HVSC download/install/ingest | Guarded mutation | 1 full cycle plus 1 bounded retry | Cache policy and storage budget defined | Reset HVSC state if the case requires isolation |
| Stream start/stop | Guarded mutation | 2 cycles | Reserved endpoints from `c64scope` | Stop streams on every exit path |
| Disk delete or bulk delete | Destructive | 1 | Test-owned disk namespace only | Confirm library is clean afterward |
| Device safety mode changes | Destructive | 1 | Dedicated settings case only | Restore baseline mode before exit |
| Stream endpoint edits or toggles | Guarded mutation | 1 edit and 1 stop/start cycle | Expected rollback known | Restore prior endpoint or disabled state |

## App-Level Safety Constraints

- Do not enter Settings and weaken retry or circuit-breaker controls just to make a flaky case pass.
- Do not use Home app-config dialogs against non-test snapshots.
- Do not delete disks, configs, or exports unless the target name is explicitly test-owned.
- Do not leave the app in a modified global mode that changes later cases.

## Recovery And Cleanup

At the end of every mutating run:

- stop background execution if playback started it
- stop C64 streaming if `c64scope` reserved it
- restore modified settings or config when the case changed global state
- remove or isolate test-owned files that would pollute later runs
- record whether cleanup fully succeeded

## Prohibited Patterns

- repeated download, ingest, reset, or reboot loops
- deletion against user-origin data
- power-off in a mixed-purpose case
- uncontrolled switching between demo and real modes
- mutating Device Safety settings without a dedicated oracle and rollback
