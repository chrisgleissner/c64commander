/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability A — launch an individual program from a disk image.
 *
 * Three launch modes:
 *   - Run  — extract the program's bytes and DMA-run them via `run_prg` (firmware
 *            handles BASIC-vs-ML autostart), wrapped by Launch Safety (capability B).
 *   - Load — same, via `load_prg` (no autostart) for monitors / dev work.
 *   - Mount & Load — mount the whole image, reset, wait for BASIC, then inject
 *            `LOAD"<name>",<bus>,1` + `RUN` for multi-load titles.
 *
 * Extraction reuses `diskImage.ts` and the same blob the app already fetches to
 * mount, so listing and extraction cost zero new device round-trips.
 */

import type { C64API } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import { enqueueKeyboardBufferInjection } from "@/lib/remoteInput/kernalFallbackInjector";
import {
  layoutForType,
  readChain,
  trimErrorTable,
  type DiskDirectoryEntry,
  type DiskImageType,
} from "@/lib/disks/diskImage";
import { bootSettle, withCartridgeParked, type BootSettleOptions } from "./launchSafety";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bytes -> PETSCII payload (ASCII maps 1:1 for the LOAD/RUN character set). */
const petscii = (text: string) => Uint8Array.from(Array.from(text, (ch) => ch.charCodeAt(0) & 0xff));

const concatBytes = (...parts: Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** Strip trailing 0xA0/0x00 name padding, keeping interior bytes exactly. */
export const stripNamePadding = (rawName: Uint8Array): Uint8Array => {
  let end = rawName.length;
  while (end > 0 && (rawName[end - 1] === 0xa0 || rawName[end - 1] === 0x00)) end -= 1;
  return rawName.slice(0, end);
};

const sanitizeFilename = (name: string, fallback: string) => {
  const trimmed = (name || "").replace(/[^\x20-\x7e]/g, "").trim();
  const base = trimmed.length > 0 ? trimmed : fallback;
  return base.toLowerCase().endsWith(".prg") ? base : `${base}.prg`;
};

/** Extract a directory entry's bytes as a complete .prg (load-address prefix + payload). */
export const extractDiskEntry = (image: Uint8Array, type: DiskImageType, entry: DiskDirectoryEntry): Uint8Array => {
  const layout = layoutForType(type, image.byteLength);
  const trimmed = trimErrorTable(image, layout);
  const bytes = readChain(trimmed, layout, entry.startTrack, entry.startSector);
  if (bytes.length < 3) throw new Error("Extracted PRG is too small");
  return bytes;
};

const assertLaunchable = (entry: DiskDirectoryEntry) => {
  if (entry.type !== "PRG") {
    throw new Error(`Only PRG files can be launched directly (this is a ${entry.type} file).`);
  }
  if (!entry.closed) {
    throw new Error("This file is not properly closed (a splat file) and cannot be launched safely.");
  }
};

export type DiskEntryLaunchMode = "run" | "load";

/**
 * Run or Load a single disk entry directly into memory (no drive), via the
 * firmware `run_prg` / `load_prg` upload path, wrapped by Launch Safety.
 */
export const runDiskEntry = async (
  api: C64API,
  image: Uint8Array,
  type: DiskImageType,
  entry: DiskDirectoryEntry,
  mode: DiskEntryLaunchMode = "run",
): Promise<void> => {
  assertLaunchable(entry);
  const bytes = extractDiskEntry(image, type, entry);
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const filename = sanitizeFilename(entry.name, `entry${entry.index}`);
  await withCartridgeParked(api, () =>
    mode === "load" ? api.loadPrgUpload(blob, { filename }) : api.runPrgUpload(blob, { filename }),
  );
  addLog("info", "Disk Explorer launched entry", { name: entry.name, mode, bytes: bytes.length });
};

/** Build the `LOAD"<name>",<bus>,1` + CR keystrokes for Mount & Load. */
export const buildLoadCommand = (rawName: Uint8Array, busId: number): Uint8Array =>
  concatBytes(petscii('LOAD"'), stripNamePadding(rawName), petscii(`",${busId},1`), Uint8Array.of(0x0d));

/** Resolve a drive's IEC bus id from `/v1/drives`, defaulting to 8. */
export const resolveBusId = async (api: C64API, drive: "a" | "b"): Promise<number> => {
  try {
    if (typeof api.getDrives !== "function") return 8;
    const drives = await api.getDrives();
    const entry = drives.drives.find((item) => Object.prototype.hasOwnProperty.call(item, drive));
    const info = entry?.[drive] ?? null;
    return typeof info?.bus_id === "number" ? info.bus_id : 8;
  } catch (error) {
    addLog("debug", "Mount & Load: could not resolve bus id; defaulting to 8", {
      error: (error as Error)?.message ?? String(error),
    });
    return 8;
  }
};

export type MountAndLoadOptions = BootSettleOptions & {
  /** Mounts the image on the drive; supplied by the caller (reuses existing mount). */
  mount: () => Promise<void>;
  /** Gap after LOAD…RETURN before RUN is typed, so the load finishes first. */
  loadRunGapMs?: number;
  delayFn?: (ms: number) => Promise<void>;
};

/**
 * Mount the whole image, reset, wait for BASIC (optionally answering a cartridge
 * boot menu), then type `LOAD"<name>",<bus>,1` + `RUN`. Drive-backed — not a
 * direct-memory launch, so it is not cartridge-parked (that would defeat a legit
 * cartridge on a Mount & Load title).
 */
export const mountAndLoadEntry = async (
  api: C64API,
  drive: "a" | "b",
  entry: DiskDirectoryEntry,
  options: MountAndLoadOptions,
): Promise<void> => {
  const wait = options.delayFn ?? delay;
  await options.mount();
  await api.machineReset();
  await bootSettle(api, { ...options, delayFn: options.delayFn });
  const busId = await resolveBusId(api, drive);
  await enqueueKeyboardBufferInjection(api, buildLoadCommand(entry.rawName, busId));
  await wait(options.loadRunGapMs ?? 400);
  await enqueueKeyboardBufferInjection(api, concatBytes(petscii("RUN"), Uint8Array.of(0x0d)));
  addLog("info", "Disk Explorer Mount & Load", { name: entry.name, drive, busId });
};
