# Local SID ROM compatibility safeguards

[PR #540](https://github.com/chrisgleissner/c64commander/pull/540) addresses
[#538](https://github.com/chrisgleissner/c64commander/issues/538) and
[#539](https://github.com/chrisgleissner/c64commander/issues/539) after the
[HVSC 85 study](https://github.com/chrisgleissner/sidflow/pull/107).
Classification: executable playback/capability changes with documentation.
Existing UI controls and copy are retained; no layout screenshot refresh is needed.

The dependency is pinned to published **libsidplayfp-wasm 1.1.1**, containing the
SIDLite capacity correction in
[library PR #15](https://github.com/chrisgleissner/libsidplayfp-wasm/pull/15).
Live, offline and seek paths use its corrected defaults; no temporary 256-event
override is needed. A regression verifies the installed package version.

The worker recognises the declared RSID BASIC requirement, returns `romRequired`
when its 8,192-byte BASIC image is unavailable, disposes an earlier engine and
refuses prerendering. A clear BASIC flag does not guarantee ROM independence;
RSID alone does not declare a general KERNAL requirement. Full-image identity
and unknown late ROM calls remain outside this positive header guard.
The independent native libSidplayEZ backend retains its own capability policy.

Adversarial review reproduced a cached-intro bypass: a reused cache key could
schedule BASIC PCM after ROM removal, and a renderer refusal left optimistic
playback active. Two new regressions fail without the follow-up correction.
The main thread now prevents that declared-BASIC cache start and stops any
optimistic intro when a renderer refuses playback. Both regressions pass with
the fix. The reviewed focused run passes 45 tests, including real 1.1.1 WASM
render, seek and prerender contracts. Full lint and both Android builds pass.

## Silent device validation

Both editions at `94aa8672a` were installed and launched using droidctl: the
default edition on Pixel 4 and `c64u-remote` on the actual Callback 8020.
The Callback's Sailfish foreground window was verified. Both installed app
workers were exercised without an audio sink: `128_Byte_Blues_BASIC.sid` is
refused without ROMs, opens with local ROMs, and renders 16,000 samples for one
second at 8 kHz stereo. Arkanoid opens and renders without ROMs. Nonzero PCM
alone does not establish musical correctness.

| Hardware stage                                           | Result                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| Preflight                                                | Pass, Callback and c64u                                      |
| Input                                                    | Pass; held direction moved eight cells; 20 rotation checks   |
| Search latency                                           | Pass; 120 samples, p50 11.3 ms, p95 15.9 ms, maximum 18.6 ms |
| Wire                                                     | Not completed; full run stopped to enforce silence           |
| AV clarity, AV latency, remote SID, local SID, crossfade | Blocked by the user's all-audio-silent requirement           |

The silent gate reports approximately zero audible seconds. Pixel media was
confirmed muted at 0/25 and both playback apps were stopped afterwards. No
speaker fidelity, audible latency or crossfade validation is claimed.
ROM dumps and HVSC binaries remain local.

## Finalization and reproduction

Release target: **1.1.1-rc1**, following fix → PR → adversarial review and fix →
merge to main → release. Final coverage, CI and merge disposition are recorded
in PR #540; these remain release gates. Recheck the open issue inventory before
release; #538 and #539 were the complete inventory when the fix was prepared.

Run `npm ci`, `npm run lint`, `npm run coverage:gate` and the focused suites
`localSidWorkerCore.test.ts`, `localSidCachedSeek.test.ts`,
`sidRenderer/wasmRendererSafety.test.ts` and
`sidRenderer/wasmRendererCore.contract.test.ts` under `tests/unit/playback/`.
Build both Android editions using the repository build helper with
`--skip-install` to retain the lockfile, and deploy through droidctl.
Under the silence constraint the permitted hardware gate was:

```sh
node tools/hil/merge_gate.mjs --host c64u --iface <LAN-IP> \
  --target handset --quiet-check --only preflight,input,search-latency \
  --json artifacts/hil-gate-silent.json
```

Do not run speaker stages or the full gate while the silence requirement applies.
