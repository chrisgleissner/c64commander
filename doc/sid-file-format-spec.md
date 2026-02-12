# SID File Format Spec (PSID/RSID)

## 1. Scope

Compact spec for `.sid` files used by HVSC.

Source of truth: https://www.hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt

## 2. Conventions

- Offsets are hexadecimal from file start (`+00`, `+04`, ...).
- Integer encoding: `WORD` = 16-bit big-endian, `LONGWORD` = 32-bit big-endian.
- `STRING` = Windows-1252 bytes, max 32 bytes, zero-terminated when shorter.
- Hex may use `0x` or `$`.

## 3. Variants

- `PSID` magic: `0x50534944`
- `RSID` magic: `0x52534944`
- Versions: `1`, `2`, `3`, `4`
- `v2/v3/v4` include v1 fields plus extended fields.

### RSID hard constraints (reject if violated)

- `magicID = RSID`
- `version ∈ {2,3,4}`
- `loadAddress = 0`
- `playAddress = 0`
- `speed = 0`
- Flag bit 1 is `C64 BASIC` flag (not `PlaySID specific`)
- Effective load address (from first 2 data bytes) must be `>= $07E8`
- `initAddress` must not target ROM/IO and must be in `$07E8-$9FFF` or `$C000-$CFFF`, unless `initAddress=0`
- If C64 BASIC flag is set, `initAddress` must be `0`

## 4. Header Layout

### v1 base header (`dataOffset = 0x0076`)

| Offset | Type | Field | Rules |
|---|---|---|---|
| `+00` | STRING(4) | `magicID` | `PSID` or `RSID` |
| `+04` | WORD | `version` | `1..4` (`RSID`: `2..4`) |
| `+06` | WORD | `dataOffset` | `0x0076` for v1, `0x007C` for v2+ |
| `+08` | WORD | `loadAddress` | `0`: read LE load address from data prefix; RSID must be `0` |
| `+0A` | WORD | `initAddress` | `0`: use effective load address |
| `+0C` | WORD | `playAddress` | `0`: player installs IRQ path; RSID must be `0` |
| `+0E` | WORD | `songs` | `1..256` |
| `+10` | WORD | `startSong` | `1..songs` (default `1`) |
| `+12` | LONGWORD | `speed` | Tune speed bitfield; RSID must be `0` |
| `+16` | STRING(32) | `name` | Windows-1252 |
| `+36` | STRING(32) | `author` | Windows-1252 |
| `+56` | STRING(32) | `released` | Windows-1252 |
| `+76` | bytes | `data` | C64 payload (v1 only) |

### v2/v3/v4 extension (`dataOffset = 0x007C`)

| Offset | Type | Field | Rules |
|---|---|---|---|
| `+76` | WORD | `flags` | Bitfield (see below), valid mask `0x03FF` |
| `+78` | BYTE | `startPage` | Relocation start page |
| `+79` | BYTE | `pageLength` | Relocation page count |
| `+7A` | BYTE | `secondSIDAddress` | v3+; v2 should be `0` |
| `+7B` | BYTE | `thirdSIDAddress` | v4 only; v2/v3 should be `0` |
| `+7C` | bytes | `data` | C64 payload |

## 5. `flags` Bitfield (`+76`)

- Bit `0` `musPlayer`
  - `0`: built-in player in payload
  - `1`: Compute! MUS data (external player required)
- Bit `1`
  - `PSID`: `psidSpecific` (`1` = PlaySID-specific behavior/samples)
  - `RSID`: `C64 BASIC` flag (`1` = BASIC part should execute; `initAddress` must be `0`)
- Bits `2-3` `clock`
  - `00` unknown, `01` PAL, `10` NTSC, `11` PAL+NTSC
- Bits `4-5` `sidModel1`
  - `00` unknown, `01` 6581, `10` 8580, `11` both
- Bits `6-7` `sidModel2` (v3)
  - Same encoding; `00` means use SID1 model
- Bits `8-9` `sidModel3` (v4)
  - Same encoding; `00` means use SID1 model
- Bits `10-15` reserved, must be `0`

## 6. Speed Semantics (`+12`)

- Bit `n` controls tune `n+1`: `0 = VBI`, `1 = CIA 1 timer`.
- For v1/v2 and for v2NG/v3/v4 when `psidSpecific=1`:
  - Tune mapping wraps every 32 tunes (`33` uses bit `0`, etc.).
- For v2NG/v3/v4 when `psidSpecific=0`:
  - Tunes `1..32` use bits `0..31`; tunes `>32` reuse bit `31`.
- Unused bits should be `0`.
- If `playAddress=0`, speed bits are kept for compatibility but modern C64-accurate players may ignore them.

## 7. Relocation Fields (`+78`, `+79`)

- `startPage=0`: tune is clean; infer free area from load range.
- `startPage=0xFF`: no free page available.
- Otherwise free range starts at `$startPage00` and spans `pageLength` pages.
- If `startPage` is `0` or `0xFF`, `pageLength` must be `0`.
- Relocation range must not overlap tune load range.
- RSID: relocation range should also avoid `$0000-$03FF`, `$A000-$BFFF`, `$D000-$FFFF`.

## 8. Multi-SID Address Fields

`secondSIDAddress` (`+7A`) and `thirdSIDAddress` (`+7B`) encode `$Dxx0` as byte `xx`.

- Valid non-zero values: even `0x42..0x7F` and even `0xE0..0xFE`
- Invalid zones: `0x00..0x41`, `0x80..0xDF`, odd values
- Invalid value means SID not present (typically `0`)
- `thirdSIDAddress` must differ from `secondSIDAddress`

Version rules:
- v2: `secondSIDAddress=0`, `thirdSIDAddress=0`
- v3: `thirdSIDAddress=0`
- v4: both may be used

## 9. Data Loading Rules

- If header `loadAddress != 0`, load payload at that address.
- If header `loadAddress == 0`, first two data bytes are little-endian effective load address and are not part of code/data payload.
- RSID requires `loadAddress=0`, so effective load address always comes from payload prefix.

## 10. Runtime Environment Requirements

### Common (PSID + RSID)

- Set `$02A6` from `clock`: PAL=`0x01`, NTSC=`0x00`.
- CIA timing reference when using CIA speed:
  - PAL: `0x4025`
  - NTSC: `0x4295`
- Cross-system compensation examples:
  - NTSC tune on PAL machine: `0x3FFB`
  - PAL tune on NTSC machine: `0x5021`

### PSID default machine state

- VIC IRQ: raster `< 0x100`; enabled iff speed bit indicates VBI.
- CIA1 Timer A: 60 Hz running; IRQ enabled iff speed bit indicates CIA.
- Other timers: disabled, latch `0xFFFF`.
- Before each `init/play` call, set bank register by call address:
  - `< $A000` -> `0x37`
  - `$A000-$CFFF` -> `0x36`
  - `$D000-$DFFF` -> `0x34`
  - `>= $E000` -> `0x35`

### RSID default machine state

- VIC IRQ: raster `0x137`, not enabled.
- CIA1 Timer A: 60 Hz running, IRQ active.
- Other timers: disabled, latch `0xFFFF`.
- Bank register fixed: `0x37`.
- `init` must not be under `$A000-$BFFF` or `$D000-$FFFF`, and must be inside load image.
- If C64 BASIC flag is set: write song index to `$030C` (`0x00` for song 1) before execution.

## 11. Minimal Validator Checklist

1. Verify `magicID`, `version`, `dataOffset` consistency.
2. Verify field ranges (`songs`, `startSong`, addresses, flags mask).
3. Apply RSID hard constraints.
4. Validate relocation and multi-SID address rules.
5. Resolve effective load address and validate target memory constraints.
