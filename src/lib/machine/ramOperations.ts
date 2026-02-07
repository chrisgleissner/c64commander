import type { C64API } from '@/lib/c64api';
import { addErrorLog } from '@/lib/logging';

export const FULL_RAM_SIZE_BYTES = 0x10000;
const IO_REGION_START = 0xD000;
const IO_REGION_END = 0xE000;
const READ_CHUNK_SIZE_BYTES = 0x0800;
const WRITE_CHUNK_SIZE_BYTES = 0x0800;

const WAIT_BETWEEN_RETRIES_MS = 120;
const DEFAULT_RETRY_ATTEMPTS = 2;

type RamRange = {
  start: number;
  endExclusive: number;
};

const FULL_RAM_RANGE: RamRange[] = [
  { start: 0x0000, endExclusive: FULL_RAM_SIZE_BYTES },
];

const CLEAR_RAM_RANGES: RamRange[] = [
  { start: 0x0000, endExclusive: IO_REGION_START },
  { start: IO_REGION_END, endExclusive: FULL_RAM_SIZE_BYTES },
];

const delay = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const toHexAddress = (value: number) => value.toString(16).toUpperCase().padStart(4, '0');

const asError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof Error) return error;
  return new Error(fallbackMessage);
};

const withRetry = async <T,>(
  operation: string,
  run: () => Promise<T>,
  attempts = DEFAULT_RETRY_ATTEMPTS,
): Promise<T> => {
  let attempt = 0;
  let lastError: Error | null = null;
  while (attempt < attempts) {
    attempt += 1;
    try {
      return await run();
    } catch (error) {
      lastError = asError(error, `${operation} failed`);
      if (attempt >= attempts) break;
      addErrorLog('RAM operation retry', {
        operation,
        attempt,
        attempts,
        error: lastError.message,
      });
      await delay(WAIT_BETWEEN_RETRIES_MS);
    }
  }
  const message = lastError?.message ?? `${operation} failed`;
  throw new Error(`${operation} failed after ${attempts} attempt(s): ${message}`);
};

const readRanges = async (api: C64API, ranges: RamRange[]) => {
  const image = new Uint8Array(FULL_RAM_SIZE_BYTES);
  for (const range of ranges) {
    for (let address = range.start; address < range.endExclusive; address += READ_CHUNK_SIZE_BYTES) {
      const chunkSize = Math.min(READ_CHUNK_SIZE_BYTES, range.endExclusive - address);
      const chunk = await withRetry(
        `Read RAM chunk at $${toHexAddress(address)}`,
        () => api.readMemory(toHexAddress(address), chunkSize),
      );
      if (chunk.length !== chunkSize) {
        throw new Error(
          `Unexpected RAM chunk length at $${toHexAddress(address)}: expected ${chunkSize}, got ${chunk.length}`,
        );
      }
      image.set(chunk, address);
    }
  }
  return image;
};

const writeRanges = async (api: C64API, image: Uint8Array, ranges: RamRange[]) => {
  for (const range of ranges) {
    for (let address = range.start; address < range.endExclusive; address += WRITE_CHUNK_SIZE_BYTES) {
      const chunkSize = Math.min(WRITE_CHUNK_SIZE_BYTES, range.endExclusive - address);
      const chunk = image.subarray(address, address + chunkSize);
      await withRetry(
        `Write RAM chunk at $${toHexAddress(address)}`,
        () => api.writeMemoryBlock(toHexAddress(address), chunk),
      );
    }
  }
};

const runPaused = async <T,>(
  api: C64API,
  operation: string,
  run: () => Promise<T>,
): Promise<T> => {
  let paused = false;
  let operationError: Error | null = null;
  let resumeFailure: Error | null = null;
  let result: T | undefined;
  try {
    await withRetry('Pause machine', () => api.machinePause());
    paused = true;
    result = await run();
    await withRetry('Resume machine', () => api.machineResume());
    paused = false;
  } catch (error) {
    operationError = asError(error, `${operation} failed`);
  } finally {
    if (paused) {
      try {
        await withRetry('Resume machine after failure', () => api.machineResume());
      } catch (error) {
        const resumeErr = asError(error, 'Resume machine failed');
        resumeFailure = resumeErr;
        addErrorLog('Failed to resume machine after RAM operation error', {
          operation,
          error: resumeErr.message,
        });
      }
    }
  }

  if (operationError && resumeFailure) {
    throw new Error(`${operation} failed: ${operationError.message}; resume failed: ${resumeFailure.message}`);
  }
  if (operationError) {
    throw new Error(`${operation} failed: ${operationError.message}`);
  }
  if (resumeFailure) {
    throw new Error(`${operation} failed while resuming: ${resumeFailure.message}`);
  }
  return result as T;
};

export const dumpFullRamImage = async (api: C64API): Promise<Uint8Array> =>
  runPaused(api, 'Save RAM', async () => readRanges(api, FULL_RAM_RANGE));

export const loadFullRamImage = async (api: C64API, image: Uint8Array) => {
  if (image.length !== FULL_RAM_SIZE_BYTES) {
    throw new Error(
      `Invalid RAM image size: expected ${FULL_RAM_SIZE_BYTES} bytes, got ${image.length} bytes`,
    );
  }
  await runPaused(api, 'Load RAM', async () => {
    await writeRanges(api, image, FULL_RAM_RANGE);
  });
};

export const clearRamAndReboot = async (api: C64API) => {
  let paused = false;
  let rebooted = false;
  let operationError: Error | null = null;
  let resumeFailure: Error | null = null;
  const zeroBlock = new Uint8Array(FULL_RAM_SIZE_BYTES);

  try {
    await withRetry('Pause machine', () => api.machinePause());
    paused = true;
    await writeRanges(api, zeroBlock, CLEAR_RAM_RANGES);
    await withRetry('Reboot machine', () => api.machineReboot());
    rebooted = true;
    paused = false;
  } catch (error) {
    operationError = asError(error, 'Reboot (Clear RAM) failed');
  } finally {
    if (paused && !rebooted) {
      try {
        await withRetry('Resume machine after clear-memory failure', () => api.machineResume());
      } catch (error) {
        const resumeErr = asError(error, 'Resume machine failed');
        resumeFailure = resumeErr;
        addErrorLog('Failed to resume machine after clear-memory error', {
          error: resumeErr.message,
        });
      }
    }
  }

  if (operationError && resumeFailure) {
    throw new Error(`Reboot (Clear RAM) failed: ${operationError.message}; resume failed: ${resumeFailure.message}`);
  }
  if (operationError) {
    throw new Error(`Reboot (Clear RAM) failed: ${operationError.message}`);
  }
  if (resumeFailure) {
    throw new Error(`Reboot (Clear RAM) failed while resuming: ${resumeFailure.message}`);
  }
};
