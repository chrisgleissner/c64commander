# C64U File Validation Plan

Classification: `CODE_CHANGE`, `UI_CHANGE`

## Objective

Implement strict structural validation for all spec-covered files before they are transmitted to the C64 Ultimate via REST upload endpoints.

## Authoritative Spec

- `doc/c64/c64-file-validation-spec.md`

## Interpretation Notes

- [x] Treat the spec as authoritative only for the explicitly listed formats: `D64`, `D71`, `D81`, `PRG`, `SID`, `MOD`, `CRT`.
- [x] Determine file type from bytes and structural rules, not filename extension alone.
- [x] Treat the internally generated SID song-length sidecar payload as out of scope for structural validation because the spec defines no format rules for it. It is not a user-supplied C64 artefact.
- [x] Resolve the spec's result-code inconsistency by honoring the specific per-format failure code named in each rule when present, even where the summary list omits it.
- [x] Resolve disk block-count inconsistencies by treating the listed valid file sizes as authoritative and deriving image block counts with integer truncation where the spec mixes exact-image bytes with extra error-info bytes.
- [ ] Confirm whether any other REST file upload payloads exist outside the centralized API upload methods.

## Phases

### Phase 1 - Discovery

- [x] Read repository instructions, README, UX guidance, and the validation spec.
- [x] Identify all upload/send code paths that transmit files to C64U over REST.
- [ ] Verify the lowest common transmission boundary to enforce validation once.

### Phase 2 - Validation Design

- [ ] Add reusable validation types and error model.
- [ ] Add deterministic file type detection using byte signatures and structural rules.
- [ ] Add a validator registry for all spec-covered formats.
- [ ] Implement defensive bounds-checked validators for `D64`, `D71`, `D81`, `PRG`, `SID`, `MOD`, and `CRT`.
- [ ] Add normalized validation failure reasons suitable for logs and user messaging.

### Phase 3 - Transmission Guard Integration

- [ ] Add a transmission guard at the REST upload boundary in the C64 API client.
- [ ] Ensure blocked files never reach `fetch`.
- [ ] Include attempted operation context and filename in rejection handling.
- [ ] Avoid duplicate user-visible error popups when higher layers also catch errors.

### Phase 4 - Logging And UX

- [ ] Emit structured log entries with event type `FILE_VALIDATION_FAILED`.
- [ ] Include timestamp, filename, detected type, validation error, and attempted operation context.
- [ ] Show a destructive top-of-screen popup for every rejection.
- [ ] Make the popup text state that transmission was aborted.

### Phase 5 - Regression Tests

- [ ] Add unit tests for valid samples for every supported format.
- [ ] Add invalid-case tests for corrupted headers, truncated inputs, invalid offsets, and illegal sizes.
- [ ] Add fuzz-style random input rejection tests that prove deterministic non-crashing behavior.
- [ ] Add API boundary tests proving invalid files do not trigger REST requests.
- [ ] Add tests proving rejection logs and top toast reporting occur.

### Phase 6 - Validation

- [ ] Run relevant linting.
- [ ] Run targeted tests.
- [ ] Run coverage and confirm validation code is `>= 90%` covered.
- [ ] Run build.

## Work Log

- 2026-03-16 00:00 UTC: Classified the task as `CODE_CHANGE` plus `UI_CHANGE`.
- 2026-03-16 00:05 UTC: Read `README.md`, `doc/ux-guidelines.md`, and `doc/c64/c64-file-validation-spec.md`.
- 2026-03-16 00:10 UTC: Confirmed the centralized REST upload methods are in `src/lib/c64api.ts`: `mountDriveUpload`, `playSidUpload`, `playModUpload`, `runPrgUpload`, `loadPrgUpload`, and `runCartridgeUpload`.
- 2026-03-16 00:14 UTC: Confirmed the app already has a top-of-screen toast system via `src/components/ui/toast.tsx` and `src/hooks/use-toast.ts`.
- 2026-03-16 00:18 UTC: Confirmed the active logging system stores ISO timestamps automatically in `src/lib/logging.ts` and can carry structured details.
- 2026-03-16 00:22 UTC: Documented the spec ambiguity around the internally generated SID `.ssl` sidecar and decided not to invent unsupported validation rules.
- 2026-03-16 00:24 UTC: Noted that the spec's final result-code summary omits some per-format codes used earlier in the document. Decision: use the rule-local code names for those failures.
- 2026-03-16 00:31 UTC: Noted that some disk-size and block-count pairs are inconsistent when extra error-info bytes are present. Decision: keep the listed sizes authoritative and compute block counts with integer truncation for validation.
