# 01 — Disk Explorer (engineering deep-dive)

**Capability A** of the [Content Explorer](./overview.md) initiative.
**Feature flag:** `disk_explorer_enabled`
**Status:** Draft / planning

> Goal: open any `.d64` / `.d71` / `.d81` and act on an *individual* program
> inside it — **Run**, **Load**, or **Mount & Load** — without mounting the disk
> and hand-driving the C64.

---

## 1. What already exists (and its one latent limit)

`src/lib/playback/diskFirstPrg.ts` already implements, for the *first* PRG only:

- `layoutForType(type, fileSize)` — 1541/1571/1581 geometry incl. error-table sizes.
- `tsOffset` / `readSector` — track/sector addressing with range checks.
- `findFirstPrg` — walks the directory sector chain and returns the first PRG.
- `readPrgChain` — follows a file's sector chain to bytes, with a loop guard.
- `dmaLoadPrg` + `looksLikeTokenisedBasic` + `setBasicPointersAndClearVars` +
  `enqueueKeyboardBufferInjection` — DMA-write and autostart (BASIC → `RUN`; ML →
  `SYS addr`).

So reading any file and launching any payload is already possible. Two things are
missing: (1) listing **all** entries, and (2) launching an **arbitrary** one.

### The latent limit to fix while generalizing

`findFirstPrg` reads an entry as:

```ts
const offset = 2 + i * 32;                 // i = 0..7
const entry = sectorData.slice(offset, offset + 32);
```

A directory sector is 256 bytes: a 2-byte "next dir track/sector" pointer at
bytes 0–1, then **eight 32-byte entries filling bytes 0..255**. With `offset =
2 + i*32`, entry `i = 7` would start at byte 226 and need bytes 226..257 — past
the 256-byte end — so it comes back short and is skipped. Harmless when you only
want the first PRG; **wrong for a full directory lister**, which must read all
eight slots.

The correct, proven windowing treats entry `i` as the 32-byte window
`sector[i*32 .. i*32 + 32]` and reads fields at window-relative offsets (the
2-byte next-dir pointer lives harmlessly in entry 0's window at +0/+1):

| Window offset | Field |
|---------------|-------|
| +2 | file-type byte — bits 0–2 type, bit 6 locked, bit 7 closed |
| +3 | first data-block track |
| +4 | first data-block sector |
| +5 … +20 | 16-byte PETSCII filename (0xA0-padded) |
| +30 … +31 | block count (u16 LE) |

File-type codes: `0 DEL, 1 SEQ, 2 PRG, 3 USR, 4 REL, 5 CBM`.

This reads all eight entries per sector and matches the byte layout the rest of
this plan assumes.

---

## 2. Refactor: `src/lib/disks/diskImage.ts` (NEW)

Move the reusable, side-effect-free primitives here; `diskFirstPrg.ts` keeps its
exported function and delegates, so its behaviour and tests are unchanged.

```ts
export type DiskImageType = "d64" | "d71" | "d81";
export type C64FileType = "DEL" | "SEQ" | "PRG" | "USR" | "REL" | "CBM" | "UNKNOWN";

export interface DiskDirectoryEntry {
  index: number;          // stable position for UI + play-plan reference
  name: string;           // decoded PETSCII, trimmed
  rawName: Uint8Array;    // 16 bytes as stored, for exact LOAD re-encoding
  type: C64FileType;
  closed: boolean;        // bit 7 of the type byte (an "open"/splat file is unsafe)
  locked: boolean;        // bit 6
  startTrack: number;
  startSector: number;
  blocks: number;         // u16 LE from window +30/+31
  loadAddress?: number;   // first 2 bytes of the file's first sector (LE), if PRG+closed
}

export function layoutForType(type: DiskImageType, fileSize: number): DiskLayout; // moved
export function readSector(image, layout, t, s): Uint8Array;                      // moved
export function readChain(image, layout, t, s): Uint8Array;                       // = readPrgChain
export function listDirectory(image: Uint8Array, type: DiskImageType): DiskDirectoryEntry[];
```

### `listDirectory`

Same directory-chain walk as `findFirstPrg` (start 18/1 for D64/D71, 40/3 for
D81; keep the `visited` set as the cyclic-chain guard; trim the error table with
`layout.hasErrorTable ? image.slice(0, totalSectors*256) : image`), but:

- iterate all 8 windows `sector[i*32 .. i*32+32]`,
- skip empty slots (type byte `== 0` or start track `== 0`),
- decode every type (not just PRG),
- for a **PRG that is closed**, read the first two bytes of its first data sector
  as `loadAddress` (LE) — cheap, and lets the UI show `$0801`-style info and lets
  Run pick BASIC vs ML without re-reading later.

Name decode: map the 16 PETSCII name bytes to display text (strip `0x00`/`0xA0`
padding; the existing `decodeDirName` already handles the `0xA0`→space case).
Keep `rawName` (the 16 bytes as stored) for Mount & Load, which must re-emit the
name exactly.

### `diskFirstPrg.ts` after the refactor

```ts
import { layoutForType, listDirectory, readChain } from "@/lib/disks/diskImage";
// findFirstPrg → listDirectory(image,type).find(e => e.type === "PRG" && e.startTrack !== 0)
// readPrgChain → readChain
// dmaLoadPrg + autostart move to diskLaunch.ts (below) and are shared
```

---

## 3. Extraction rule (get this exactly right)

`readChain` follows the sector chain from an entry's start track/sector. Two
guards and one subtlety:

- **Circular-chain guard:** a `visited` set of `track:sector`; throw on revisit
  ("corrupt image").
- **Size cap:** stop past a sane max (2 MiB) to bound a malformed chain.
- **Last-sector byte count (the subtlety):** in every sector, bytes 0–1 are the
  link. For a **non-final** sector, byte 0 = next track, byte 1 = next sector, and
  the 254 data bytes are `sector[2..256]`. For the **final** sector, byte 0 = 0
  and **byte 1 is the index of the last valid data byte**, so the data is
  `sector[2 .. byte1 + 1]` — i.e. `byte1 - 1` data bytes, clamped to `[2, 255]`.
  (Reading `2 + byte1` bytes instead over-reads by one; use `byte1 + 1` as the
  exclusive end.)

```ts
if (nextTrack === 0) {
  const lastByte = Math.min(Math.max(nextSector, 2), 255);
  out.push(...sector.slice(2, lastByte + 1));   // final sector
  break;
}
out.push(...sector.slice(2, 256));              // full sector
```

---

## 4. Launch any entry: `src/lib/playback/diskLaunch.ts` (NEW)

Three launch modes map to three device behaviours.

### Run and Load (direct-memory, no drive)

Generalize `loadFirstDiskPrgViaDma` into an entry-driven launcher:

```ts
export interface DiskLaunchOptions { autostart: boolean; }

export async function loadDiskEntryViaDma(api, image, type, entry, { autostart }) {
  const layout = layoutForType(type, image.byteLength);
  const trimmed = layout.hasErrorTable ? image.slice(0, layout.totalSectors * 256) : image;
  const prg = readChain(trimmed, layout, entry.startTrack, entry.startSector);
  if (prg.length < 3) throw new Error("Extracted PRG is too small");

  const { loadAddress, endAddressExclusive } = await dmaLoadPrg(api, prg);
  if (!autostart) return { name: entry.name, loadAddress, endAddressExclusive, isBasic: false };

  const isBasic = loadAddress === 0x0801 && looksLikeTokenisedBasic(prg);
  if (isBasic) {
    await setBasicPointersAndClearVars(api, loadAddress, endAddressExclusive);
    await enqueueKeyboardBufferInjection(api, petsciiCommand("RUN"));
  } else {
    await enqueueKeyboardBufferInjection(api, petsciiCommand(`SYS ${loadAddress}`));
  }
  return { name: entry.name, loadAddress, endAddressExclusive, isBasic };
}
```

- **Run** = `autostart: true`.
- **Load** = `autostart: false` (DMA-resident, no `RUN`/`SYS`).

**Simpler alternative worth considering.** The extracted bytes form a complete
`.prg` (`loadAddress` LE prefix + payload), so instead of the writemem DMA path
you can hand the bytes straight to the firmware:

- **Run** → `POST /v1/runners:run_prg` (multipart) — the app's existing
  `runPrgUpload`.
- **Load** → `POST /v1/runners:load_prg` (multipart) — a firmware endpoint the app
  doesn't call yet; add `c64api.loadPrgUpload(blob, { filename })` mirroring
  `runPrgUpload`.

The firmware runners handle BASIC-vs-ML autostart themselves, which removes the
`looksLikeTokenisedBasic` heuristic from the launch path. Recommend
`run_prg`/`load_prg` uploads as the **primary** path (less client-side logic),
keeping `dmaLoadPrg` as the fallback the code already trusts. Either way the run
is wrapped by Launch Safety (capability B): `withCartridgeParked(api, () => …)`.

### Mount & Load (drive-backed, for multi-load titles)

Not a direct-memory launch. Mount the whole image, reset, wait for BASIC, then
type the load. The exact, working sequence:

```ts
export async function mountAndLoadEntry(api, drive, mode, image, type, entry, opts) {
  await mountImage(api, drive, mode, image);          // reuse write-back-aware mount
  await api.put("/v1/machine:reset");
  await bootSettle(opts);                              // ~2.8 s; optional boot-menu answer (cap. B)
  const bus = await busIdFor(api, drive);              // read /v1/drives → bus_id, default 8
  // rawName is the exact 16 PETSCII bytes; do NOT re-encode the display name
  await enqueueKeyboardBufferInjection(api, petscii(`LOAD"`), entry.rawName, petscii(`",${bus},1\r`));
  await delay(400);
  await enqueueKeyboardBufferInjection(api, petscii("RUN\r"));
}
```

Details that matter:

- **`bootSettle`** waits ~2.8 s for BASIC after reset (stock BASIC is ready in
  ~2.5 s). This is where the optional **boot-menu answer** fires when a cartridge
  is configured (see `02-launch-safety.md`): press the configured key ~1 s in,
  then wait out the remaining time plus a small handoff margin.
- **Bus id** comes from `/v1/drives` (`bus_id`, default 8); don't hard-code 8.
- **Use `rawName`, not the display name.** The `LOAD` must carry the on-disk
  PETSCII bytes exactly; re-encoding the trimmed display string can corrupt names
  with shifted or graphic characters.
- The 400 ms gap between the `LOAD…RETURN` and `RUN` lets the load finish before
  RUN is typed.
- Mount & Load composes with multi-disk grouping already in the app.

---

## 5. Play-plan integration

`executePlayPlan` (`src/lib/playback/playbackRouter.ts`) switches on plan kind
(`sid`/`mod`/`prg`/`crt`/`disk`). Add a narrow variant so an in-disk launch flows
through the same router:

```ts
type DiskFilePlan = {
  kind: "disk-file";
  diskPath: string;          // fetch + cache identity
  diskType: DiskImageType;
  entryIndex: number;        // stable index from listDirectory
  mode: "run" | "load";      // Mount & Load stays the existing "disk" kind
};

case "disk-file": {
  const image = await fetchDiskBytes(plan.diskPath);         // reuse existing fetch/cache
  const entry = listDirectory(image, plan.diskType)[plan.entryIndex];
  if (!entry) throw new Error("File no longer present in image");
  if (entry.type !== "PRG" || !entry.closed) throw new Error("Not a runnable PRG");
  await withCartridgeParked(api, () =>
    /* run_prg/load_prg upload, or loadDiskEntryViaDma fallback */);
  break;
}
```

Disk bytes come from the **same blob the app already fetches to mount** (local
file handle or FTP `readFtpFile`), so parsing/extraction add **zero** new device
round-trips. Cache the parsed directory keyed by `path + size + mtime` — this is
the same cache In-Image Search (capability C) consumes.

---

## 6. UI

Reuse existing primitives; add no new interaction paradigm.

- **Entry point:** a disk row (in Disks' `HomeDiskManager`, and in Browse & Import
  results) gains an "Open" affordance that enters a **disk contents** view.
- **Contents view:** render `listDirectory` output with `SelectableActionList`
  (already used for playlists/library) — one row per entry: name, type badge,
  block count, and `$hhhh` load address for closed PRGs.
- **Per-row actions:** Run, Load, Mount & Load, from the same action-menu the
  Disks page already uses. Non-PRG or open ("splat", not `closed`) entries show
  their launch actions disabled with an inline reason.
- **Header:** the disk name and format from the image header (D64/D71 at 18/0
  offset +0x90; D81 at 40/0 offset +0x04).
- **Display profiles:** inherit Small/Standard/Large; on Small fold type/blocks
  under the name.

---

## 7. Edge cases & guards

| Case | Handling |
|------|----------|
| Corrupt / cyclic directory chain | `visited` set breaks the loop; surface "unreadable directory" |
| Cyclic file sector chain | `readChain` throws on a revisited sector; per-row error |
| Open ("splat") file, `closed == false` | Extraction unreliable; disable launch with a reason |
| Non-standard image size | `layoutForType` throws; disable Explorer for that image with a reason (G64 and odd sizes out of scope) |
| Entry moved/deleted since listing | Re-parse at launch; if `entryIndex` no longer resolves, clean error |
| PETSCII names with shifted/graphic chars | `rawName` used verbatim for `LOAD`; display name is best-effort |
| Payload past address space | `dmaLoadPrg` already rejects; `run_prg` path lets the firmware reject |
| Freezer cartridge configured | Wrapped by `withCartridgeParked` (capability B) |

---

## 8. Test plan

- **Unit (`tests/unit/disks`)** — `listDirectory` returns **all eight** slots on a
  full sector (regression against the `2 + i*32` skip); type decode + block count;
  `loadAddress` read for closed PRGs; circular-chain and short-sector guards
  throw. `readChain` last-sector byte count exact against a known file.
- **Unit (`tests/unit/playFiles`)** — `disk-file` plan routes Run vs Load
  correctly and is wrapped by `withCartridgeParked`; Mount & Load emits
  `LOAD"<rawName>",<bus>,1` + `RUN` with the right bus id.
- **Regression tripwire** — `diskFirstPrg`'s existing tests stay green
  **unchanged** after delegating to `diskImage.ts`.
- **Playwright (`diskManagement.spec.ts`)** — open a disk → contents render → Run
  the third file → mock device receives the expected run/load call.
- **Mock (`src/lib/mock`)** — add a multi-file `.d64` fixture with a known
  directory (including a full 8-entry sector and a payload past the first file).

---

## 9. Out of scope (here)

- G64 and non-standard image sizes (no reliable directory geometry).
- Writing *into* an image from Explorer (extract-only; disk writes stay with the
  mount write-back model).
- In-image *search* — capability C (`03-in-image-search.md`), which consumes
  `listDirectory` from here.
