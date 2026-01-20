import { describe, it, expect, vi } from 'vitest';
import { buildPlayPlan, executePlayPlan } from '@/lib/playback/playbackRouter';

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
    const task = executePlayPlan(api as any, plan, { drive: 'a' });
    await vi.runAllTimersAsync();
    await task;
    expect(api.machineReset).toHaveBeenCalled();
    expect(api.mountDriveUpload).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('throws on unsupported formats', () => {
    expect(() => buildPlayPlan({ source: 'local', path: 'demo.txt' })).toThrow('Unsupported');
  });
});
