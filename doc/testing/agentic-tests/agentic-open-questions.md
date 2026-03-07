# Agentic Open Questions

## Purpose

This file holds the remaining non-iOS blockers so they stay explicit instead of turning into hidden assumptions.

## Blockers

| ID | Feature area | Blocker class | Question | Temporary handling |
| --- | --- | --- | --- | --- |
| AOQ-001 | Home machine control | safety-policy decision needed | Which reset, reboot, and power-off sequences are allowed in routine autonomous regression versus dedicated destructive cases? | Keep them out of shared smoke coverage and use the budgets in `agentic-safety-policy.md` |
| AOQ-002 | RAM workflows | missing expected behavior | What exact postconditions prove save, load, and reboot-and-clear RAM success on real hardware? | Treat RAM save/load/clear as separate guarded cases only |
| AOQ-003 | Printer and stream control | missing expected behavior | What counts as success for printer reset and stream endpoint edits beyond request acceptance? | Use UI plus diagnostics only and mark final verdicts as partial |
| AOQ-004 | Config breadth | missing expected behavior | Which config categories are safe and deterministic enough for autonomous mutation on the target physical lab device set? | Keep broad config exploration read-only by default |
| AOQ-005 | Clock sync | missing expected behavior | What tolerance window defines a successful clock synchronization? | Do not claim deterministic pass/fail beyond request/refresh success |
| AOQ-006 | Diagnostics export and settings transfer | missing expected behavior | What constitutes successful completion when Android share-sheet or SAF surfaces hand work off to the OS? | Validate file creation where possible; otherwise classify as partial |
| AOQ-007 | HVSC lifecycle | safety-policy decision needed | What storage, time, and retry budget is acceptable for repeated download/install/ingest in the shared lab? | Limit to one full cycle plus one retry |
| AOQ-008 | Test-owned storage namespaces | missing instrumentation | Which Android and C64U paths are reserved for agentic staging, export, and safe deletion? | Require explicit test-owned prefixes before destructive file operations |
| AOQ-009 | Device Safety settings | safety-policy decision needed | May autonomous runs switch presets or advanced throttling controls outside dedicated settings cases? | Default to no; only dedicated cases may change them |

## Intentional Out Of Scope

- iOS physical execution and controller implementation remain out of scope for the current Kubuntu-driven lab.
