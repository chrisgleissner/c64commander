import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPlayPlan, executePlayPlan } from '@/lib/playback/playbackRouter';
import { addErrorLog } from '@/lib/logging';
import { injectAutostart } from '@/lib/playback/autostart';
import { loadFirstDiskPrgViaDma } from '@/lib/playback/diskFirstPrg';

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
}));

vi.mock('@/lib/playback/autostart', async () => {
  const actual = await vi.importActual<typeof import('@/lib/playback/autostart')>('@/lib/playback/autostart');
  return {
    ...actual,
    injectAutostart: vi.fn(),
  };
});

vi.mock('@/lib/playback/diskFirstPrg', () => ({
  loadFirstDiskPrgViaDma: vi.fn().mockResolvedValue({
    name: 'TEST',
    loadAddress: 0x0801,
    endAddressExclusive: 0x0810,
    isBasic: true,
  }),
}));

beforeEach(() => {
  vi.mocked(injectAutostart).mockClear();
  vi.mocked(loadFirstDiskPrgViaDma).mockClear();
});

const createApiMock = () => ({
  playSid: vi.fn().mockResolvedValue({ errors: [] }),
  playSidUpload: vi.fn().mockResolvedValue({ errors: [] }),
  playMod: vi.fn().mockResolvedValue({ errors: [] }),
  playModUpload: vi.fn().mockResolvedValue({ errors: [] }),
  runPrg: vi.fn().mockResolvedValue({ errors: [] }),
  runPrgUpload: vi.fn().mockResolvedValue({ errors: [] }),
  loadPrg: vi.fn().mockResolvedValue({ errors: [] }),
  loadPrgUpload: vi.fn().mockResolvedValue({ errors: [] }),
  runCartridge: vi.fn().mockResolvedValue({ errors: [] }),
  runCartridgeUpload: vi.fn().mockResolvedValue({ errors: [] }),
  mountDrive: vi.fn().mockResolvedValue({ errors: [] }),
  mountDriveUpload: vi.fn().mockResolvedValue({ errors: [] }),
  machineReset: vi.fn().mockResolvedValue({ errors: [] }),
  machineReboot: vi.fn().mockResolvedValue({ errors: [] }),
  readMemory: vi.fn().mockResolvedValue(new Uint8Array([0])),
  writeMemory: vi.fn().mockResolvedValue({ errors: [] }),
});

describe('playbackRouter', () => {
  it('routes SID playback from Ultimate filesystem', async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: 'ultimate', path: '/MUSIC/DEMO.SID' });
    await executePlayPlan(api as any, plan);
    expect(api.playSid).toHaveBeenCalledWith('/MUSIC/DEMO.SID', undefined);
  });

  it('routes SID playback from local upload', async () => {
    const api = createApiMock();
    const file = new File(['sid'], 'demo.sid');
    const plan = buildPlayPlan({ source: 'local', path: '/demo.sid', file });
    await executePlayPlan(api as any, plan);
    expect(api.playSidUpload).toHaveBeenCalled();
  });

  it('routes disk images to mount + autostart', async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    const file = new File(['disk'], 'demo.d64');
    const plan = buildPlayPlan({ source: 'local', path: '/demo.d64', file });
    const task = executePlayPlan(api as any, plan, { drive: 'a', rebootBeforeMount: true });
    await vi.runAllTimersAsync();
    await task;
    expect(api.machineReboot).toHaveBeenCalled();
    expect(api.mountDriveUpload).toHaveBeenCalled();
    expect(vi.mocked(injectAutostart)).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('uses DMA loader when disk autostart is set to DMA', async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    class TestBlob extends Blob {
      async arrayBuffer() {
        return new ArrayBuffer(4);
      }
    }
    const file = new TestBlob(['disk'], { type: 'application/octet-stream' }) as unknown as File;
    const plan = buildPlayPlan({ source: 'local', path: '/demo.d64', file });
    const task = executePlayPlan(api as any, plan, { drive: 'a', rebootBeforeMount: true, diskAutostartMode: 'dma' });
    await vi.runAllTimersAsync();
    await task;
    expect(vi.mocked(loadFirstDiskPrgViaDma)).toHaveBeenCalled();
    expect(vi.mocked(injectAutostart)).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('routes PRG uploads in load mode', async () => {
    const api = createApiMock();
    const file = new File(['prg'], 'demo.prg');
    const plan = buildPlayPlan({ source: 'local', path: '/demo.prg', file });
    await executePlayPlan(api as any, plan, { loadMode: 'load' });
    expect(api.loadPrgUpload).toHaveBeenCalled();
  });

  it('logs and throws when local SID data is missing', async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: 'local', path: '/demo.sid' });
    await expect(executePlayPlan(api as any, plan)).rejects.toThrow('Missing local SID data');
    expect(vi.mocked(addErrorLog)).toHaveBeenCalled();
  });

  it('throws on unsupported formats', () => {
    expect(() => buildPlayPlan({ source: 'local', path: 'demo.txt' })).toThrow('Unsupported');
  });
});
