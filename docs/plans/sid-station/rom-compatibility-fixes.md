# Local SID ROM compatibility safeguards

Addresses #538 and #539 after the HVSC 85 study (SIDFlow PR #107).
Classification: executable playback/capability changes; existing UI controls and
copy are retained. No layout screenshot refresh is required.

- [x] Identify the declared RSID BASIC requirement without claiming every RSID
      needs ROMs or a clear flag guarantees independence.
- [x] Return `romRequired` through the actual WASM core/dispatcher when that
      BASIC image is unavailable; dispose a previous engine and refuse prerendering.
- [x] Pin the published libsidplayfp-wasm 1.1.1 capacity correction. Live, offline
      and seek paths use its corrected defaults; no temporary 256-event override
      is needed. The exact package is verified at runtime by a regression test.
- [x] Focused regression tests fail against origin/main source and pass with
      the changes. Real WASM contract tests pass (32 focused tests before adversarial review).
- [x] Android debug build, exact-package install, notice generation and full lint pass.
- [x] Adversarial review reproduced a cached-intro ROM-check bypass. Two new
      regressions fail without the follow-up fix: declared BASIC playback no longer
      starts a stale intro after ROM removal, and a worker refusal stops an intro
      already started optimistically.
- [ ] Complete native deployment on the intended phones and real playback.
- [ ] Run the hardware merge gate against c64u, then final coverage/patch gates.
- [ ] Address review/CI and merge only when required checks pass.

ROM dumps and HVSC input binaries remain local. Full-image identity and unknown
late ROM calls are outside this header-level positive guard. The native
libSidplayEZ backend retains its own capability behavior.

Release target: **1.1.1-rc1**. Fix → PR → adversarial review and fix → merge
to main → release. The live issue inventory contains #538 and #539; recheck
before release and resolve any additional open Commander issues.
