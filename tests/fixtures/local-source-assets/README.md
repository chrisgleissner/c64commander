# Local source fixture assets

These files are deterministic, format-aware demo fixtures used for local-source staging during physical-device validation.

## Regenerate

```bash
npm run fixtures:local-source
```

## Files

- `demo.sid`: minimal PSID v2 file.
- `demo.mod`: minimal ProTracker module (`M.K.` signature).
- `demo.prg`: C64 PRG container with a tiny BASIC SYS stub.
- `demo.crt`: C64 cartridge container with one ROM chip packet.
- `demo.d64`: 1541-sized disk image with basic directory/BAM scaffolding.
- `demo.d71`: 1571-sized disk image with basic directory/BAM scaffolding.
- `demo.d81`: 1581-sized disk image with basic directory/BAM/header scaffolding.
- `Songlengths.md5`: minimal Songlengths mapping fixture.
