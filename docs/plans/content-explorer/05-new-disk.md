# 05 — New Disk (engineering deep-dive)

**Capability F** of the [Content Explorer](./overview.md) initiative.
**Feature flag:** `new_disk_enabled`
**Status:** Implemented behind `new_disk_enabled` (experimental, off by default).

> **As-built (shipped).** `src/lib/disks/createDisk.ts` ships `buildCreateDiskPlan` — a pure,
> unit-testable URL/param builder (rejects the virtual `/`, rejects a path in the name,
> clamps the label to 16 chars, D64 tracks 35–41 default 35, DNP tracks 1–255 required,
> appends the extension, percent-encodes path and query with `%20`) — and `c64api.createDisk`
> calls it. The **New disk** action on the **Disks** page opens
> `src/components/disks/NewDiskDialog.tsx` (Type D64/D71/D81/DNP, file name, disk label ≤16,
> tracks for D64/DNP, storage folder defaulting to `/USB0`); its **Create & mount** button
> creates the image and mounts it. Matches the plan.

> Goal: create a formatted blank image on the device, so a user can make a fresh
> disk to save to without leaving the app.

---

## 1. What's missing today

`createDiskEntry` (`src/lib/disks/diskTypes.ts`) only builds a **library metadata
record**. There is no way to create an actual formatted image on the device. The
firmware can do it; the app just doesn't call it.

---

## 2. The firmware endpoint (confirmed)

The device formats a blank image via a per-type file runner:

```
PUT /v1/files/<folder>/<name>:create_d64?diskname=<label>&tracks=<n>
PUT /v1/files/<folder>/<name>:create_d71?diskname=<label>
PUT /v1/files/<folder>/<name>:create_d81?diskname=<label>
PUT /v1/files/<folder>/<name>:create_dnp?diskname=<label>&tracks=<n>
```

Rules learned from the device's behaviour:

- **D64** takes `tracks` 35–41 (default 35). **DNP** *requires* `tracks` (1–255).
  D71/D81 take no track count.
- **`diskname`** is the on-disk label, max **16** characters.
- **Folder must be real.** The top-level `/` is a *virtual* device list (USB0, SD,
  Flash, Temp), not a writable directory; the firmware returns a misleading "PATH
  DOESN'T EXIST" if you create there. Require a real folder (e.g. `USB0` or a
  subfolder) and reject `/` up front with a clear message.
- **URL encoding:** the firmware wants `%20` for spaces (not `+`), so build the
  query by percent-encoding each value; percent-encode the path too (keep `/`
  as the path separator) so spaces, `#`, and other valid FAT filename characters
  aren't parsed as URL syntax.
- **Timeout:** formatting on slow USB media can exceed the normal REST budget;
  allow ~30 s for this call specifically.
- **G64 is not exposed** by the firmware API — omit it.

---

## 3. `c64api.createDisk(...)` (NEW)

```ts
type CreateDiskKind = "d64" | "d71" | "d81" | "dnp";

interface CreateDiskArgs {
  folder: string;      // e.g. "/USB0/Games" — must not be "/"
  name: string;        // file name only, no path; extension appended if missing
  kind: CreateDiskKind;
  diskLabel?: string;  // ≤16 chars; defaults to the name stem
  tracks?: number;     // d64: 35-41 (default 35); dnp: required 1-255
}

async createDisk(args: CreateDiskArgs): Promise<CreateDiskResult> {
  const folder = "/" + args.folder.replace(/^\/+|\/+$/g, "");
  if (folder === "/") throw new Error("Pick a storage folder (e.g. USB0) — the top-level / is virtual.");

  let name = args.name.trim();
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..")
    throw new Error("Enter a file name, not a path.");
  if (!name.toLowerCase().endsWith("." + args.kind)) name += "." + args.kind;

  const label = (args.diskLabel || name.replace(/\.[^.]+$/, "")).slice(0, 16);
  const params: Record<string, string> = { diskname: label };
  if (args.kind === "d64") {
    const t = args.tracks ?? 35;
    if (t < 35 || t > 41) throw new Error("D64 tracks must be 35–41.");
    params.tracks = String(t);
  } else if (args.kind === "dnp") {
    if (!args.tracks || args.tracks < 1 || args.tracks > 255) throw new Error("DNP needs tracks (1–255).");
    params.tracks = String(args.tracks);
  }

  const path = `${folder}/${name}`;
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const url = `/v1/files${encodePath(path)}:create_${args.kind}?${qs}`;  // %20 not '+'
  return this.put(url, { timeoutMs: 30_000 });
}
```

`encodePath` percent-encodes each path segment but preserves `/`. Reuse the app's
existing config-item write timing style (the elevated timeout) for the call.

---

## 4. UX (Disks page)

- A **New disk** action on the Disks page opens a dialog:
  - **Type:** D64 / D71 / D81 / DNP.
  - **Tracks:** shown only for D64 (35/40, default 35) and DNP (required).
  - **Label:** ≤16 chars (default = file-name stem).
  - **Folder:** a storage-folder picker (reuse the C64U source browser; disallow
    the virtual `/`).
- On success, **mount the new image read/write** on a chosen drive — a freshly
  created disk exists to be written to, so read/write is the sensible default for
  this one action (it does not change the app's default mount mode elsewhere).
- Then add it to the disk library like any other image and refresh drive state.

---

## 5. Device-safety interaction

Formatting is a higher-priority mutation. If a background index/scan is running
over FTP, pause it and wait for any in-flight transfer to finish before issuing
the create (the Device Safety layer already serializes REST mutations; make sure
the create participates rather than racing the indexer). Resume the scan after.

---

## 6. Test plan

- **Unit** — `createDisk` builds the correct URL for each kind: label clamped to
  16 chars; D64 track bounds; DNP requires tracks; `/` rejected; path/query
  percent-encoding uses `%20`; extension appended when missing.
- **Playwright (`diskManagement.spec.ts`)** — New disk dialog → create on a mock
  device → assert the expected `PUT …:create_d64?…` and that the result is mounted
  read/write and appears in the library.
- **Mock** — a device create handler that validates params and returns success /
  "PATH DOESN'T EXIST" for `/`.
