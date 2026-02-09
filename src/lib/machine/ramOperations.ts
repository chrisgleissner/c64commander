import type { C64API } from '@/lib/c64api';
import { addErrorLog } from '@/lib/logging';
import { checkC64Liveness } from '@/lib/machine/c64Liveness';
import { createActionContext, getActiveAction } from '@/lib/tracing/actionTrace';
import { recordDeviceGuard } from '@/lib/tracing/traceSession';

export const FULL_RAM_SIZE_BYTES = 0x10000;
const IO_REGION_START = 0xD000;
const IO_REGION_END = 0xE000;
const READ_CHUNK_SIZE_BYTES = 0x1000;
const WRITE_CHUNK_SIZE_BYTES = 0x10000;
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
  onRetry?: (error: Error, attempt: number, maxAttempts: number) => Promise<void>,
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
      if (onRetry) {
        await onRetry(lastError, attempt, attempts);
      }
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

const recordRamTrace = (payload: Record<string, unknown>) => {
  const action = getActiveAction() ?? createActionContext('ram.operation', 'system', null);
  recordDeviceGuard(action, payload);
};

const ensureLiveness = async (api: C64API, operation: string) => {
  const sample = await checkC64Liveness(api);
  if (sample.decision === 'wedged') {
    throw new Error(`${operation} aborted: C64 appears wedged.`);
  }
  recordRamTrace({
    operation,
    status: 'liveness-ok',
    decision: sample.decision,
  });
  return sample;
};

const recoverFromLivenessFailure = async (api: C64API, operation: string) => {
  let sample: Awaited<ReturnType<typeof checkC64Liveness>> | null = null;
  try {
    sample = await checkC64Liveness(api);
  } catch (error) {
    const err = asError(error, 'Liveness check failed');
    recordRamTrace({ operation, status: 'liveness-error', error: err.message });
    throw err;
  }

  if (sample.decision !== 'wedged') {
    recordRamTrace({ operation, status: 'liveness-ok', decision: sample.decision });
    return;
  }

  recordRamTrace({ operation, status: 'liveness-wedged', decision: sample.decision });
  await withRetry('Reset machine after liveness failure', () => api.machineReset());
  await delay(500);
  const afterReset = await checkC64Liveness(api);
  if (afterReset.decision !== 'wedged') {
    recordRamTrace({ operation, status: 'liveness-recovered', decision: afterReset.decision });
    return;
  }

  recordRamTrace({ operation, status: 'liveness-reset-failed', decision: afterReset.decision });
  await withRetry('Reboot machine after liveness failure', () => api.machineReboot());
  await delay(800);
  const afterReboot = await checkC64Liveness(api);
  if (afterReboot.decision === 'wedged') {
    recordRamTrace({ operation, status: 'liveness-reboot-failed', decision: afterReboot.decision });
    throw new Error(`${operation} aborted: C64 remained wedged after reboot.`);
  }
  recordRamTrace({ operation, status: 'liveness-recovered', decision: afterReboot.decision });
};

const readRanges = async (api: C64API, ranges: RamRange[]) => {
  const image = new Uint8Array(FULL_RAM_SIZE_BYTES);
  for (const range of ranges) {
    for (let address = range.start; address < range.endExclusive; address += READ_CHUNK_SIZE_BYTES) {
      const chunkSize = Math.min(READ_CHUNK_SIZE_BYTES, range.endExclusive - address);
      recordRamTrace({
        operation: 'ram-read',
        status: 'start',
        address: toHexAddress(address),
        expectedLength: chunkSize,
      });
      const chunk = await withRetry(
        `Read RAM chunk at $${toHexAddress(address)}`,
        () => api.readMemory(toHexAddress(address), chunkSize),
        DEFAULT_RETRY_ATTEMPTS,
        async () => recoverFromLivenessFailure(api, 'Save RAM'),
      );
      if (chunk.length !== chunkSize) {
        recordRamTrace({
          operation: 'ram-read',
          status: 'error',
          address: toHexAddress(address),
          expectedLength: chunkSize,
          actualLength: chunk.length,
        });
        throw new Error(
          `Unexpected RAM chunk length at $${toHexAddress(address)}: expected ${chunkSize}, got ${chunk.length}`,
        );
      }
      recordRamTrace({
        operation: 'ram-read',
        status: 'success',
        address: toHexAddress(address),
        expectedLength: chunkSize,
        actualLength: chunk.length,
      });
      image.set(chunk, address);
    }
  }
  return image;
};

const writeFullImage = async (api: C64API, image: Uint8Array) => {
  recordRamTrace({
    operation: 'ram-write',
    status: 'start',
    address: toHexAddress(0),
    expectedLength: image.length,
  });
  await withRetry(
    'Write full RAM image at $0000',
    () => api.writeMemoryBlock(toHexAddress(0), image),
    DEFAULT_RETRY_ATTEMPTS,
    async () => recoverFromLivenessFailure(api, 'Load RAM'),
  );
  recordRamTrace({
    operation: 'ram-write',
    status: 'success',
    address: toHexAddress(0),
    expectedLength: image.length,
    actualLength: image.length,
  });
};

const writeRanges = async (api: C64API, image: Uint8Array, ranges: RamRange[]) => {
  for (const range of ranges) {
    for (let address = range.start; address < range.endExclusive; address += WRITE_CHUNK_SIZE_BYTES) {
      const chunkSize = Math.min(WRITE_CHUNK_SIZE_BYTES, range.endExclusive - address);
      const chunk = image.subarray(address, address + chunkSize);
      recordRamTrace({
        operation: 'ram-write',
        status: 'start',
        address: toHexAddress(address),
        expectedLength: chunkSize,
      });
      await withRetry(
        `Write RAM chunk at $${toHexAddress(address)}`,
        () => api.writeMemoryBlock(toHexAddress(address), chunk),
        DEFAULT_RETRY_ATTEMPTS,
        async () => recoverFromLivenessFailure(api, 'Load RAM'),
      );
      recordRamTrace({
        operation: 'ram-write',
        status: 'success',
        address: toHexAddress(address),
        expectedLength: chunkSize,
        actualLength: chunkSize,
      });
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

export const dumpFullRamImage = async (api: C64API): Promise<Uint8Array> => {
  await ensureLiveness(api, 'Save RAM');
  return runPaused(api, 'Save RAM', async () => readRanges(api, FULL_RAM_RANGE));
};

export const loadFullRamImage = async (api: C64API, image: Uint8Array) => {
  if (image.length !== FULL_RAM_SIZE_BYTES) {
    throw new Error(
      `Invalid RAM image size: expected ${FULL_RAM_SIZE_BYTES} bytes, got ${image.length} bytes`,
    );
  }
  await ensureLiveness(api, 'Load RAM');
  await runPaused(api, 'Load RAM', async () => {
    await writeFullImage(api, image);
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
    await delay(800);
    await ensureLiveness(api, 'Reboot (Clear RAM)');
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
