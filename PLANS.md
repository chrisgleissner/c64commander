# Plans

## Goal
Implement 8 sections of UX, device control, playback, and diagnostics improvements while keeping builds/tests green.

---

## 1. Streams UI Bug (Home Page)

**Problem**: ON/OFF toggle is semantically wrong (no REST streaming-state API); Stop→Start loses destination IP:port.

**Solution**: Replace ON/OFF toggle with Start/Stop buttons. Use `PUT /v1/streams/{stream}:start?ip=ip[:port]` and `PUT /v1/streams/{stream}:stop`. Never clear destination on stop.

- [ ] Add `startStream(stream, ip)` and `stopStream(stream)` methods to `c64api.ts`
- [ ] Update `homeStreams.ts`: remove `enabled` toggle logic; keep destination parsing, validation, and persistence
- [ ] Replace ON/OFF `Button` in HomePage Streams section with Start + Stop buttons at same position
- [ ] Ensure destination IP:port persists across stop, re-render, navigation
- [ ] Update feedback phrasing: "Start command sent" / "Stop command sent"
- [ ] Update unit tests for stream logic
- [ ] Update E2E tests referencing stream toggle

---

## 2. Global Slider Behavior Change

**Problem**: Sliders may block UI on REST calls. Need smooth, async, best-effort updates during movement with guaranteed final value on release.

**Solution**: Centralized slider-to-device adapter pattern. All sliders use `onValueChange` for immediate UI state, fire-and-forget REST during movement, guaranteed REST on `onValueCommit`.

- [ ] Create `src/lib/ui/sliderDeviceAdapter.ts` — shared hook/utility for slider-to-device pattern
- [ ] Refactor SID Volume/Pan sliders (HomePage/SidCard) to use adapter
- [ ] Refactor LED Intensity slider to use adapter
- [ ] Refactor CPU Speed slider (ConfigItemRow) to use adapter
- [ ] Refactor PlaybackSettingsPanel duration slider to use adapter
- [ ] Refactor VolumeControls volume slider to use adapter
- [ ] Ensure all handlers are synchronous (no await blocking pointer events)
- [ ] Add unit tests for adapter: UI handlers not awaiting, final REST on release
- [ ] Verify existing slider tests still pass

---

## 3. HVSC Ingestion Crash + Stuck Progress

**Problem**: Ingestion crashes app; after restart progress appears stuck with infinite spinner.

- [ ] Read crash logs / identify crash root cause in `hvscIngestionRuntime.ts`
- [ ] Implement crash-safe state machine: NOT_STARTED → EXTRACTING → INDEXING → COMPLETE → FAILED
- [ ] Persist minimal state; validate on startup
- [ ] Ensure progress is monotonic (extractedFiles increases, indexedFiles increases)
- [ ] Implement stuck detection (no progress while active → mark FAILED with reason)
- [ ] Provide clear retry action that cleans minimum state and restarts
- [ ] Clean up partial artifacts on failure
- [ ] Add unit tests for ingestion controller and persistence
- [ ] Regression test: simulated crash mid-ingestion → no infinite progress on next start

---

## 4. SID Playback - Send Song Length When Possible

**Problem**: Playlist items show song length but playback from C64 filesystem doesn't transmit it.

**Solution**: When playing a SID from the Ultimate filesystem, prefer FTP download + upload-play with song length when both FTP and songlength.md5 are available.

- [ ] Review current `executePlayPlan` SID path — confirm FTP+upload path exists for `source==='ultimate'` with duration
- [ ] Ensure songlength lookup is performed for Ultimate filesystem SIDs when duration not provided
- [ ] Add songlength.md5 lookup for Ultimate path SIDs in `buildPlayPlan` or caller
- [ ] If FTP fails after eligibility, fall back to filesystem-play with logging
- [ ] If upload-play fails, fall back to filesystem-play
- [ ] Show "Preparing (downloading)" feedback during FTP download
- [ ] Add unit tests for branching logic and fallbacks
- [ ] Add integration test if mock infrastructure exists

---

## 5. Add Items Interstitial - Reduce Size to Content

**Problem**: Dialog is too large vertically and horizontally.

- [ ] Review `ItemSelectionDialog.tsx` `DialogContent` sizing
- [ ] Reduce padding, margins, max-width, max-height
- [ ] Ensure container sizes to content
- [ ] Confirm visually on emulator that interstitial is drastically smaller

---

## 6. Printer Section Homepage - Concise Redesign

**Problem**: Printer section is not concise. Must use Quick Config style inline-dropdown-on-select, no native Android dropdowns, short codes for charsets.

- [ ] Redesign printer section to use inline text-that-becomes-dropdown pattern
- [ ] Use two-column label+value layout aligned consistently
- [ ] Shorten charset names: US/UK, DE, FR/IT, etc.
- [ ] Reduce vertical space dramatically
- [ ] Ensure no native Android dropdown widgets appear
- [ ] Verify section density matches LED / Quick Config sections

---

## 7. RAM Buttons + Liveness Checks

**Problem**: "Jiffy clock read returns zero bytes, expected three." Liveness checks broken.

- [ ] Read `c64Liveness.ts` and `c64api.ts` `readMemory` implementation
- [ ] Reproduce via curl against real c64u: `GET /v1/machine:readmem?address=00A2&length=3`
- [ ] Reproduce raster read: `GET /v1/machine:readmem?address=D012&length=1`
- [ ] Capture HTTP status, headers, raw body for both reads
- [ ] Fix request formation or parsing based on curl results
- [ ] Add diagnostics logging around liveness reads
- [ ] Ensure liveness check distinguishes REST reachable vs C64 core responsive
- [ ] Verify Save RAM / Load RAM / Reboot Clear RAM flows work
- [ ] Add unit tests for parsing and byte length assertions
- [ ] Add regression test preventing "zero bytes expected N"

---

## 8. Testing, CI, and Completion

- [ ] Run `npm run lint` — fix errors
- [ ] Run `npm run test` — fix failures
- [ ] Run `npm run build` — fix errors
- [ ] Commit all changes with clear messages
- [ ] Push and verify CI green
- [ ] Confirm PLANS.md tasks all checked off

## Notes
- Follow repo guidelines in .github/copilot-instructions.md and doc/ux-guidelines.md.
- Avoid unrelated formatting or refactors.
