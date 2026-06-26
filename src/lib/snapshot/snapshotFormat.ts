/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MemoryRange, SnapshotMetadata, SnapshotType } from "./snapshotTypes";
import { SNAPSHOT_TYPE_CODES, SNAPSHOT_TYPE_FROM_CODE } from "./snapshotTypes";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAGIC = "C64SNAP\0";
/** RAM-only snapshots (no CPU state). The historical default. */
const FORMAT_VERSION_V1 = 1;
/** CPU+RAM snapshots — adds CPU state / full stack page / capability blocks (carried in JSON metadata). */
const FORMAT_VERSION_V2 = 2;
/** Versions this decoder understands. v1 files keep loading unchanged. */
const SUPPORTED_VERSIONS: ReadonlySet<number> = new Set([FORMAT_VERSION_V1, FORMAT_VERSION_V2]);
const HEADER_SIZE = 28;
const RANGE_DESCRIPTOR_SIZE = 4; // uint16 start + uint16 length

/**
 * Header `flags` bit: the snapshot carries captured 6510 CPU state (in the JSON
 * metadata `cpu` block). A fast, binary-level presence hint; the authoritative
 * source remains the JSON metadata.
 */
export const FLAG_HAS_CPU_STATE = 0x0001;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encodeText = (value: string): Uint8Array => new TextEncoder().encode(value);

const decodeText = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const writeUint16LE = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, value, true);
};

const writeUint32LE = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value, true);
};

const readUint16LE = (view: DataView, offset: number) => view.getUint16(offset, true);

const readUint32LE = (view: DataView, offset: number) => view.getUint32(offset, true);

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encodes a snapshot into the .c64snap binary format.
 *
 * Layout:
 *   [0–27]   28-byte header
 *   [28…]    range descriptors (4 bytes × range_count)
 *   […]      memory blocks (concatenated)
 *   […]      optional UTF-8 JSON metadata
 */
export const encodeSnapshot = (
  snapshotType: SnapshotType,
  timestamp: Date,
  ranges: MemoryRange[],
  blocks: Uint8Array[],
  metadata?: SnapshotMetadata,
): Uint8Array => {
  if (ranges.length !== blocks.length) {
    throw new Error(`encodeSnapshot: ranges.length (${ranges.length}) !== blocks.length (${blocks.length})`);
  }

  const metadataJson = metadata ? encodeText(JSON.stringify(metadata)) : new Uint8Array(0);
  const totalDataBytes = blocks.reduce((sum, b) => sum + b.length, 0);
  const descriptorsSize = ranges.length * RANGE_DESCRIPTOR_SIZE;

  const metadataOffset = metadataJson.length > 0 ? HEADER_SIZE + descriptorsSize + totalDataBytes : 0;

  // A CPU+RAM snapshot bumps the format version and sets the CPU-state flag bit.
  // RAM-only snapshots stay v1 with flags=0 — identical bytes to before, so old
  // readers and the existing RAM-only path are completely unaffected.
  const hasCpuState = Boolean(metadata?.cpu);
  const version = hasCpuState ? FORMAT_VERSION_V2 : FORMAT_VERSION_V1;
  const flags = hasCpuState ? FLAG_HAS_CPU_STATE : 0;

  const totalSize = HEADER_SIZE + descriptorsSize + totalDataBytes + metadataJson.length;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  // Magic bytes
  const magic = encodeText(MAGIC);
  out.set(magic, 0);

  // Header fields
  writeUint16LE(view, 8, version);
  writeUint16LE(view, 10, SNAPSHOT_TYPE_CODES[snapshotType]);
  writeUint32LE(view, 12, Math.floor(timestamp.getTime() / 1000));
  writeUint16LE(view, 16, ranges.length);
  writeUint16LE(view, 18, flags);
  writeUint32LE(view, 20, metadataOffset);
  writeUint32LE(view, 24, metadataJson.length);

  // Range descriptors
  let descriptorOffset = HEADER_SIZE;
  for (const range of ranges) {
    writeUint16LE(view, descriptorOffset, range.start);
    writeUint16LE(view, descriptorOffset + 2, range.length);
    descriptorOffset += RANGE_DESCRIPTOR_SIZE;
  }

  // Memory blocks
  let blockOffset = HEADER_SIZE + descriptorsSize;
  for (const block of blocks) {
    out.set(block, blockOffset);
    blockOffset += block.length;
  }

  // Metadata
  if (metadataJson.length > 0) {
    out.set(metadataJson, metadataOffset);
  }

  return out;
};

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

export type DecodedSnapshot = {
  version: number;
  snapshotType: SnapshotType;
  timestamp: Date;
  ranges: MemoryRange[];
  /** One block per range, in matching order. */
  blocks: Uint8Array[];
  metadata: SnapshotMetadata | null;
  /** Raw header flags (u16). */
  flags: number;
  /** True iff the snapshot carries captured CPU state (per the JSON metadata). */
  hasCpuState: boolean;
};

/**
 * Decodes a .c64snap binary blob.
 * Throws on invalid magic, truncated header, or unknown version.
 */
export const decodeSnapshot = (bytes: Uint8Array): DecodedSnapshot => {
  if (bytes.length < HEADER_SIZE) {
    throw new Error(`Invalid .c64snap: too short (${bytes.length} bytes)`);
  }

  const magic = decodeText(bytes.slice(0, 8));
  if (magic !== MAGIC) {
    throw new Error(`Invalid .c64snap: bad magic "${magic.replace(/\0/g, "\\0")}"`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const version = readUint16LE(view, 8);
  if (!SUPPORTED_VERSIONS.has(version)) {
    throw new Error(`Unsupported .c64snap version: ${version}`);
  }

  const typeCode = readUint16LE(view, 10);
  const snapshotType: SnapshotType = SNAPSHOT_TYPE_FROM_CODE[typeCode] ?? "custom";

  const timestampSeconds = readUint32LE(view, 12);
  const timestamp = new Date(timestampSeconds * 1000);

  const rangeCount = readUint16LE(view, 16);
  const flags = readUint16LE(view, 18);
  const metadataOffset = readUint32LE(view, 20);
  const metadataSize = readUint32LE(view, 24);

  const descriptorsEnd = HEADER_SIZE + rangeCount * RANGE_DESCRIPTOR_SIZE;
  if (bytes.length < descriptorsEnd) {
    throw new Error(`Invalid .c64snap: truncated range descriptors`);
  }

  const ranges: MemoryRange[] = [];
  for (let i = 0; i < rangeCount; i++) {
    const off = HEADER_SIZE + i * RANGE_DESCRIPTOR_SIZE;
    const start = readUint16LE(view, off);
    const length = readUint16LE(view, off + 2);
    ranges.push({ start, length });
  }

  const blocks: Uint8Array[] = [];
  let blockOffset = descriptorsEnd;
  for (const range of ranges) {
    if (blockOffset + range.length > bytes.length) {
      throw new Error(`Invalid .c64snap: truncated memory block at $${range.start.toString(16)}`);
    }
    blocks.push(bytes.slice(blockOffset, blockOffset + range.length));
    blockOffset += range.length;
  }

  let metadata: SnapshotMetadata | null = null;
  if (metadataOffset > 0 && metadataSize > 0) {
    if (metadataOffset + metadataSize > bytes.length) {
      throw new Error(`Invalid .c64snap: truncated metadata`);
    }
    const jsonBytes = bytes.slice(metadataOffset, metadataOffset + metadataSize);
    try {
      metadata = JSON.parse(decodeText(jsonBytes)) as SnapshotMetadata;
    } catch (error) {
      throw new Error(`Invalid .c64snap: malformed metadata JSON — ${(error as Error).message}`);
    }
  }

  // The JSON metadata `cpu` block is authoritative for CPU-state presence; the
  // header flag bit is a hint that must agree with it.
  const hasCpuState = Boolean(metadata?.cpu);

  return { version, snapshotType, timestamp, ranges, blocks, metadata, flags, hasCpuState };
};
