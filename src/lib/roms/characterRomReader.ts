/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Read the character ROM from the connected C64 by riding its live interrupt.
 *
 * KERNAL and BASIC are plain DMA reads. The character ROM is not: it shows at `$D000` only while
 * CHAREN is clear, which only the C64's CPU can arrange (see `characterRomPayload.ts`). So this
 * borrows the CPU snapshot's RLI pattern (`captureEngine.ts`): pause, save every byte about to
 * change, install the handler in the cassette buffer, hook `$0314`, resume, wait for the copy,
 * pause, read it, then put every byte back and resume. No path leaves the machine paused or hooked
 * while the network is still answering.
 *
 * It runs code on the user's machine, so only the explicit Settings action calls it.
 */

import { addErrorLog } from "@/lib/logging";
import { IRQ_VECTOR_0314, toHexAddress, type CaptureCpuApi } from "@/lib/snapshot/cpu/captureEngine";
import {
  buildCharacterRomCopyHandler,
  CHARACTER_ROM_BYTES,
  type CharacterRomCopyLayout,
} from "@/lib/snapshot/cpu/six502/characterRomPayload";

export type CharacterRomReadOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** No interrupt ran the copy in time: the program masks interrupts or has the KERNAL banked out. */
export class CharacterRomReadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `no interrupt went through $0314 within ${timeoutMs} ms, so the character ROM could not be copied. ` +
        `Reset the machine and try again.`,
    );
    this.name = "CharacterRomReadTimeoutError";
  }
}

const DEFAULT_TIMEOUT_MS = 2000;
/** The copy takes about 40 ms; this only lets one that was already under way at the deadline finish. */
const COPY_GRACE_MS = 1000;
const DEFAULT_POLL_INTERVAL_MS = 50;

type Originals = { irqVector: Uint8Array; region: Uint8Array; buffer: Uint8Array };

const read = (api: CaptureCpuApi, address: number, length: number) => api.readMemory(toHexAddress(address), length);
const write = (api: CaptureCpuApi, address: number, bytes: Uint8Array | number[]) =>
  api.writeMemoryBlock(toHexAddress(address), Uint8Array.from(bytes));

const readFlags = async (api: CaptureCpuApi, layout: CharacterRomCopyLayout) => {
  const [armed, done] = await read(api, layout.armed, 2);
  return { entered: armed === 0x00, done: done === 0x01 };
};

const armedHandler = (handler: Uint8Array, layout: CharacterRomCopyLayout, irqVector: Uint8Array): Uint8Array => {
  const patched = new Uint8Array(handler);
  patched.set(irqVector.subarray(0, 2), layout.origVec - layout.base);
  patched[layout.armed - layout.base] = 0x01;
  return patched;
};

/** Returns with the machine paused: true once the copy is done, false if no interrupt finished it in time. */
const waitForCopy = async (
  api: CaptureCpuApi,
  layout: CharacterRomCopyLayout,
  options: CharacterRomReadOptions,
): Promise<boolean> => {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let deadline = now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let graceGiven = false;
  for (;;) {
    if ((await readFlags(api, layout)).done) {
      await api.machinePause();
      return true;
    }
    if (now() >= deadline) {
      await api.machinePause();
      // Read again once paused: the interrupt can arrive between the last poll and the pause (HARD9-039).
      const flags = await readFlags(api, layout);
      if (flags.done) return true;
      if (!flags.entered || graceGiven) return false;
      graceGiven = true;
      deadline = now() + COPY_GRACE_MS;
      await api.machineResume();
    }
    await sleep(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }
};

/**
 * Put back every byte the read changed, starting paused, and resume. Where the CPU is decides the
 * order: the handler is never overwritten while the CPU may still be running it.
 */
const unhook = async (api: CaptureCpuApi, layout: CharacterRomCopyLayout, originals: Originals): Promise<void> => {
  const { entered, done } = await readFlags(api, layout);
  await write(api, IRQ_VECTOR_0314, originals.irqVector);
  if (!entered) {
    await write(api, layout.base, originals.region);
    await api.machineResume();
    return;
  }
  if (!done) {
    await write(api, layout.release, [0x01]);
    await api.machineResume();
    addErrorLog("The character ROM copy was still running; its handler and copy were left in C64 RAM", {
      handler: toHexAddress(layout.base),
      buffer: toHexAddress(layout.buffer),
    });
    return;
  }
  await write(api, layout.buffer, originals.buffer);
  await write(api, layout.release, [0x01]);
  await api.machineResume();
  // Released, the handler jumps straight on to the original vector; it is long gone by the time this lands.
  await write(api, layout.base, originals.region);
};

/** Best-effort undo after a failure, logged rather than thrown so the original failure reaches the caller. */
const recover = async (
  api: CaptureCpuApi,
  layout: CharacterRomCopyLayout,
  originals: Originals | null,
  hooked: boolean,
  cause: unknown,
): Promise<void> => {
  try {
    if (hooked && originals) {
      await api.machinePause();
      await unhook(api, layout, originals);
      return;
    }
    if (originals) {
      await write(api, IRQ_VECTOR_0314, originals.irqVector);
      await write(api, layout.base, originals.region);
    }
    await api.machineResume();
  } catch (error) {
    addErrorLog("Could not put the C64 back after a failed character ROM read", {
      cause: cause instanceof Error ? cause.message : String(cause),
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/** The 4 KiB character ROM as the C64's CPU sees it. Validation is the caller's job. */
export const readCharacterRomViaIrq = async (
  api: CaptureCpuApi,
  options: CharacterRomReadOptions = {},
): Promise<Uint8Array> => {
  const { bytes: handler, layout } = buildCharacterRomCopyHandler();
  let originals: Originals | null = null;
  let hooked = false;
  let restoring = false;
  let chargen: Uint8Array | null;
  await api.machinePause();
  try {
    originals = {
      irqVector: await read(api, IRQ_VECTOR_0314, 2),
      region: await read(api, layout.base, layout.length),
      buffer: await read(api, layout.buffer, CHARACTER_ROM_BYTES),
    };
    await write(api, layout.base, armedHandler(handler, layout, originals.irqVector));
    await write(api, IRQ_VECTOR_0314, [layout.base & 0xff, layout.base >> 8]);
    hooked = true;
    await api.machineResume();

    const copied = await waitForCopy(api, layout, options);
    chargen = copied ? await read(api, layout.buffer, CHARACTER_ROM_BYTES) : null;
    restoring = true;
    await unhook(api, layout, originals);
  } catch (error) {
    if (restoring) {
      addErrorLog("Could not put the C64 back after reading its character ROM; trying again", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
    // Restoring included: a failure there can leave the machine paused or the handler installed, and
    // unhook is safe to repeat (it reads the flags afresh and releases the handler before it is removed).
    await recover(api, layout, originals, hooked, error);
    throw error;
  }
  if (!chargen) throw new CharacterRomReadTimeoutError(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return chargen;
};
