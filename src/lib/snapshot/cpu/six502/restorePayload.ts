/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { CpuState } from "../cpuState";
import {
  assemble,
  bne,
  bpl,
  bit,
  cld,
  cmp,
  db,
  dex,
  dw,
  jmp,
  label,
  lda,
  ldx,
  ldy,
  pla,
  rti,
  sei,
  sta,
  tax,
  tay,
  txs,
} from "./assembler";

/**
 * The 6502 image for the CUR (Custom Upload-cartridge Restore) path.
 *
 * The restore vehicle is a **normal 8 KiB CBM80 autostart cartridge**
 * (`CART_TYPE_8K`, EXROM=0/GAME=1) — *not* an Ultimax cart. This matches the
 * firmware's own `bootcrt.tas` and, crucially, the FPGA cart logic
 * (`all_carts_v4.vhd`, `when c_8k`): a `c_8k` cartridge is **permanently
 * disabled** by writing a byte with bits 7:6 = `01` (i.e. `$40`) to `$DFFF`.
 * That is the mechanism that lets the restored RAM at `$8000-$9FFF` show
 * through once we are done — verified in the FPGA source, not assumed.
 *
 * Flow (the app plays the role the firmware's DMA engine plays for `bootcrt`):
 *   1. `run_crt` boots the cart; the KERNAL autostart vectors through `$8000`
 *      into `coldStart`, which `SEI`s and writes {@link RESTORE_FLAG_READY} to
 *      {@link RESTORE_FLAG_ADDR}, then spins until it reads
 *      {@link RESTORE_FLAG_GO}.
 *   2. The app polls the flag, DMA-writes the entire snapshot RAM image (the
 *      cart lives in ROM, so RAM writes land underneath it), writes the 3-byte
 *      RTI frame into the free stack, then writes the GO byte (the release).
 *   3. The cart copies the {@link buildFinalizeStub} bytes into the free stack
 *      at {@link RESTORE_STUB_ADDR} and `JMP`s to them.
 *   4. The finalize stub disables the cart, restores `$02`/`$01`, sets `SP`,
 *      restores `A`/`X`/`Y`, and `RTI`s — resuming the program at its exact PC
 *      with its exact registers.
 *
 * The handshake byte is `$02` (zero-page scratch, the same byte `bootcrt` uses).
 * It is **excluded** from the bulk RAM write so it can never read as GO
 * prematurely, and its true snapshot value is restored by the finalize stub.
 */

/** Zero-page handshake/release byte (cart↔app). Excluded from the bulk RAM write. */
export const RESTORE_FLAG_ADDR = 0x02;
/** cart → app: the cart has reached its spin loop and RAM may be written. */
export const RESTORE_FLAG_READY = 0xa5;
/** app → cart: all RAM + the RTI frame are in place; finalize and resume. */
export const RESTORE_FLAG_GO = 0x5a;

/** The finalize stub is copied here (bottom of the stack page — free stack). */
export const RESTORE_STUB_ADDR = 0x0100;

/** The cartridge ROM loads at $8000 and is exactly 8 KiB. */
export const CART_LOAD_ADDR = 0x8000;
export const CART_IMAGE_SIZE = 0x2000;

/** The Ultimate cart-disable register and the value (bits 7:6 = 01) that kills a c_8k cart. */
export const CART_DISABLE_ADDR = 0xdfff;
export const CART_DISABLE_VALUE = 0x40;

/**
 * Minimum stack pointer for which the free-stack layout (stub at $0100 + a
 * 3-byte RTI frame just below the saved SP) is guaranteed not to collide. A
 * snapshot taken with a near-full stack (SP below this) cannot be CPU-restored
 * via this layout and must be refused by the caller.
 */
export const RESTORE_MIN_SAFE_SP = 0x20;

/** The CBM80 autostart signature bytes ("CBM80" with the top bit set on "CBM"). */
const CBM80 = [0xc3, 0xc2, 0xcd, 0x38, 0x30];

const u8 = (v: number) => v & 0xff;

/** Extra context the finalize stub needs beyond the register file. */
export type RestoreMemoryContext = {
  /** Snapshot value of `$01` (6510 port — banking). */
  mem01: number;
  /** Snapshot value of `$02` (the handshake byte), restored on the way out. */
  mem02: number;
};

/**
 * Builds the position-independent finalize stub that runs from the free stack.
 * Straight-line (no internal branches), so the emitted bytes are identical
 * wherever it is copied; the assembler `org` is therefore irrelevant.
 */
export const buildFinalizeStub = (cpu: CpuState, ctx: RestoreMemoryContext): Uint8Array => {
  const spMinus3 = u8(cpu.sp - 3); // RTI pops 3 → SP ends at the saved SP.
  return assemble(
    [
      lda.imm(CART_DISABLE_VALUE),
      sta.abs(CART_DISABLE_ADDR), // disable the c_8k cart → $8000 ROM becomes restored RAM
      lda.imm(u8(ctx.mem02)),
      sta.zp(RESTORE_FLAG_ADDR), // restore the handshake byte to its true value
      lda.imm(u8(ctx.mem01)),
      sta.zp(0x01), // restore banking
      ldx.imm(spMinus3),
      txs(), // SP = savedSP - 3
      ldy.imm(u8(cpu.y)),
      lda.imm(u8(cpu.a)),
      ldx.imm(u8(cpu.x)), // X last — TXS already consumed the SP value
      rti(), // pops P, PCL, PCH from the app-written frame → resume at saved PC
    ],
    RESTORE_STUB_ADDR,
  ).bytes;
};

/**
 * Builds the full 8 KiB cartridge ROM image (load address $8000) for restoring
 * the given CPU state. The finalize stub is embedded as data and copied to the
 * free stack at run time.
 */
export const buildRestoreImage = (cpu: CpuState, ctx: RestoreMemoryContext): Uint8Array => {
  const stub = buildFinalizeStub(cpu, ctx);

  const { bytes } = assemble(
    [
      // --- CBM80 autostart header ---
      dw("coldStart"), // $8000 cold-start vector
      dw("warmStart"), // $8002 warm-start (NMI) vector
      db(...CBM80), // $8004 "CBM80"

      // --- cold start: arm the handshake and spin ---
      label("coldStart"),
      sei(),
      cld(),
      ldx.imm(0xff),
      txs(),
      lda.imm(RESTORE_FLAG_READY),
      sta.zp(RESTORE_FLAG_ADDR),
      label("wait"),
      lda.zp(RESTORE_FLAG_ADDR),
      cmp.imm(RESTORE_FLAG_GO),
      bne("wait"),

      // --- release received: copy the finalize stub into the free stack and run it ---
      ldx.imm(stub.length - 1),
      label("copy"),
      lda.absx("stubSrc"),
      sta.absx(RESTORE_STUB_ADDR),
      dex(),
      bpl("copy"),
      jmp.abs(RESTORE_STUB_ADDR),

      label("stubSrc"),
      db(...stub),

      // --- warm start: ack CIA2, unwind the KERNAL NMI frame, return ---
      label("warmStart"),
      bit.abs(0xdd0d),
      pla(),
      tay(),
      pla(),
      tax(),
      pla(),
      rti(),
    ],
    CART_LOAD_ADDR,
  );

  if (bytes.length > CART_IMAGE_SIZE) {
    throw new Error(`buildRestoreImage: image is ${bytes.length} bytes, exceeds ${CART_IMAGE_SIZE}`);
  }
  const image = new Uint8Array(CART_IMAGE_SIZE);
  image.set(bytes, 0);
  return image;
};
