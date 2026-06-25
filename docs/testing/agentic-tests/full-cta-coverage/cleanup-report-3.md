# Pixel 4 Cleanup Report 3

## Status

`PARTIAL_CLEANUP_PROVEN`

This is not a full certification cleanup because the exhaustive matrix did not complete. It proves the most important residual state after the S1 failure was cleared by the user restart and app readback.

Handover 7 continuation note: the app was launched again for S1 replay, but the app-visible baseline stayed `Device Not connected` / `Unable to connect to C64U` while direct `c64u` probes returned HTTP `403`. No mount/eject cycle was attempted, and the app was stopped again.

## Evidence

- Current APK launched after restart: `restart-health/screenshots/current-cf84d-after-restart-launch.png`
- Current Disks state after restart: `restart-health/screenshots/current-cf84d-disks-after-restart.png`
- C64U direct health after restart: `restart-health/logs/commands/c64u-info.stdout.log`
- App stopped after cleanup capture: `restart-health/logs/droidmind/stop-after-restart-cleanup.jsonl`
- Handover 7 baseline block: `s1-five-cycle-cf84d-resume/baseline-block-result.json`
- Handover 7 app stop: `s1-five-cycle-cf84d-resume/logs/droidmind/stop-after-baseline-degraded.jsonl`

## Restored / Proven

| Item | Status | Evidence |
| --- | --- | --- |
| Installed app | PROVEN | versionName `0.8.9-cf84d`, versionCode `2044` |
| C64U connected | PROVEN | Green `C64U`, device `c64u`, firmware `1.1.0` |
| Drive A disk state | PROVEN | Drive A ON, `No disk mounted` |
| Drive B disk state | PROVEN | Drive B OFF, `No disk mounted` |
| App process | PROVEN | stopped after capture; stopped again after Handover 7 baseline block |

## Not Fully Proven

- Full app-local settings restoration was not audited after the incomplete run.
- Full C64 config restoration was not audited.
- Playlist/playback cleanup was not audited.
- Complete baseline-vs-final diff was not produced.
- `u64` direct unauthenticated probe still returned connection reset and was not used for Pixel 4 C64U certification.

## Conclusion

The immediate Disks residual risk from the failed Cycle 2 eject is cleared: Drive A is visible as `No disk mounted` after target restart. Full certification cleanup remains incomplete, so cleanup does not qualify the run for GO or CONDITIONAL.
