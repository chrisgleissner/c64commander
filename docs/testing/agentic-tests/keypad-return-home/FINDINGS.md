# The keypad user who keeps coming home — findings

Hardware-in-the-loop hunt run against `c64u` (C64 Ultimate, firmware `1.2RC`, `192.168.1.146`) and
a Pixel 4 (`9B081FFAZ001WX`) driven at Callback 8020 geometry: `wm size 480x640`, `wm density 240`,
which the app reports as 320 x 427 CSS px at DPR 1.5 on the `compact` display profile. The edition
under test is the 8020 one, `uk.gleissner.c64uremote`, build `1.0.5-rc1-6ba84`.

The U64 was not driven or probed at any point. Two of the findings below are about tooling that had
been pointing debug installs at it.

## Findings

| # | Scenario | Finding | Evidence | Status |
| - | -------- | ------- | -------- | ------ |
