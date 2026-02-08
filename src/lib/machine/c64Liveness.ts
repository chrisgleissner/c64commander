import type { C64API } from '@/lib/c64api';
import { createActionContext, getActiveAction } from '@/lib/tracing/actionTrace';
import { recordDeviceGuard } from '@/lib/tracing/traceSession';

const DEFAULT_JIFFY_WAIT_MS = 50;
const DEFAULT_RASTER_ATTEMPTS = 3;
const DEFAULT_RASTER_DELAY_MS = 2;

const delay = (ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
});

const toUint24 = (bytes: Uint8Array) => bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);

const readJiffyClock = async (api: C64API) => {
    const bytes = await api.readMemory('00A2', 3);
    if (bytes.length < 3) {
        throw new Error(`Jiffy clock read returned ${bytes.length} byte(s).`);
    }
    return toUint24(bytes);
};

const readRaster = async (api: C64API) => {
    const bytes = await api.readMemory('D012', 1);
    if (bytes.length < 1) {
        throw new Error(`Raster read returned ${bytes.length} byte(s).`);
    }
    return bytes[0];
};

const recordLivenessTrace = (payload: Record<string, unknown>) => {
    const action = getActiveAction() ?? createActionContext('device.liveness', 'system', null);
    recordDeviceGuard(action, payload);
};

export type C64LivenessDecision = 'healthy' | 'irq-stalled' | 'wedged';

export type C64LivenessSample = {
    jiffyStart: number;
    jiffyEnd: number;
    jiffyAdvanced: boolean;
    rasterStart: number;
    rasterEnd: number;
    rasterChanged: boolean;
    decision: C64LivenessDecision;
};

export const checkC64Liveness = async (
    api: C64API,
    options: {
        jiffyWaitMs?: number;
        rasterAttempts?: number;
        rasterDelayMs?: number;
    } = {},
): Promise<C64LivenessSample> => {
    const jiffyWaitMs = options.jiffyWaitMs ?? DEFAULT_JIFFY_WAIT_MS;
    const rasterAttempts = Math.max(1, options.rasterAttempts ?? DEFAULT_RASTER_ATTEMPTS);
    const rasterDelayMs = Math.max(0, options.rasterDelayMs ?? DEFAULT_RASTER_DELAY_MS);

    const jiffyStart = await readJiffyClock(api);
    const rasterStart = await readRaster(api);

    await delay(jiffyWaitMs);

    const jiffyEnd = await readJiffyClock(api);
    let rasterEnd = rasterStart;
    let rasterChanged = false;

    for (let attempt = 0; attempt < rasterAttempts; attempt += 1) {
        await delay(rasterDelayMs);
        const next = await readRaster(api);
        rasterEnd = next;
        if (next !== rasterStart) {
            rasterChanged = true;
            break;
        }
    }

    const jiffyAdvanced = jiffyEnd !== jiffyStart;
    const decision: C64LivenessDecision = jiffyAdvanced
        ? 'healthy'
        : rasterChanged
            ? 'irq-stalled'
            : 'wedged';

    recordLivenessTrace({
        decision,
        jiffyStart,
        jiffyEnd,
        jiffyAdvanced,
        rasterStart,
        rasterEnd,
        rasterChanged,
        jiffyWaitMs,
        rasterAttempts,
        rasterDelayMs,
    });

    return {
        jiffyStart,
        jiffyEnd,
        jiffyAdvanced,
        rasterStart,
        rasterEnd,
        rasterChanged,
        decision,
    };
};
