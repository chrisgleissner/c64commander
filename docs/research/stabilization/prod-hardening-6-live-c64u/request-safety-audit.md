# Request Safety Audit — prod-hardening-6

Audit status: **COMPLETE** — 2026-05-28.

## Findings

### 1. REST call paths

All REST calls are routed through `withRestInteraction` (deviceInteractionManager). No raw production `fetch` calls to c64u endpoints were found.

Scan result:
```
rg -n "fetch\(" src -g '*.ts' -g '*.tsx'
```
All `fetch` usages in `src/lib/c64api/` are wrapped by the REST gateway; no direct fetch in pages or hooks.

### 2. FTP call paths

All FTP calls are routed through `withFtpInteraction`. The web bridge (`ftpClient.web.ts`) previously had `FTP_BRIDGE_MAX_ATTEMPTS = 3`; PH6-02 reduced this to 1. All retries are now owned exclusively by the `withFtpInteraction` gateway.

### 3. Telnet call paths

All Telnet calls are routed through `withTelnetInteraction`. PH6-03 removed eager `loadCapabilities()` from mount; Telnet traffic is now strictly demand-driven.

### 4. Config write paths

All config writes are routed through `scheduleConfigWrite`. PH6-01 added generation-based cancellation; stale writes from prior selected device are cancelled on `resetInteractionState`.

### 5. High-frequency controls

Live observation — S5 (CPU Speed slider), S7 (Audio Mixer slider), S9 (volume slider), S10/S12 (browse):

- No request storm was observed during slider drags or browse navigation.
- Coalescing/throttling mechanisms correctly paced writes.
- c64u REST remained healthy after every high-frequency interaction.

### 6. Live scenario inconsistencies

No live scenario revealed behavior inconsistent with the intended safety model.

### 7. Continued work after navigation/cancellation

- S10: Cancelled Add items dialog mid-browse. No stale FTP requests observed in logcat after cancellation.
- S12: Same pattern. Cancellation was clean.
- S13: Background/foreground: app health cycle resumed correctly; no burst on foreground.
- S14: Force-stop: c64u REST remained healthy (exit 0) immediately after force-stop.

### 8. c64u liveness

c64u survived all 14 scenarios in the fixed-APK validation run. The single REST outage observed earlier in S3 was reclassified as PH6-04: an app-caused defect in `healthCheckEngine.ts` that unconditionally sent bare CRLF to Telnet port 23 when no password was configured. That defect is fixed in this PR.

### 9. App-caused crash evidence

One app-caused crash was identified and fixed in this PR:
- S3 from the first live run was caused by the app's unconditional post-auth CRLF in the Telnet health probe even when `authenticateTelnetIfNeeded()` returned early with `passwordSent: false`.
- FTP and Telnet TCP surviving while REST crashed helped isolate the failure to the c64u REST process rather than a full device freeze.
- The root cause is now fixed by gating CRLF emission on `authResult.passwordSent`.
- The fixed APK re-ran S3 and the full 14-scenario suite with no recurrence.

### 10. No bypass found

Static scan and live evidence confirm:
- No direct production fetch to c64u outside approved gateways.
- No FTP bridge internal retries beyond 1 (PH6-02).
- No Telnet mount storms (PH6-03).
- No stale config writes after saved-device switch (PH6-01).

## Conclusion

The request safety model is sound after PH6-01 through PH6-04. Live validation confirms no bypass, no request storm, and no remaining app-caused c64u instability across the fixed-APK 14-scenario run. The earlier S3 outage is now understood as PH6-04, a concrete app defect that this PR fixes.
