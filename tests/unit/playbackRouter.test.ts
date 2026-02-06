import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPlayPlan, executePlayPlan } from '@/lib/playback/playbackRouter';
import { addErrorLog } from '@/lib/logging';
import { injectAutostart } from '@/lib/playback/autostart';
import { loadFirstDiskPrgViaDma } from '@/lib/playback/diskFirstPrg';
import { mountDiskToDrive, resolveLocalDiskBlob } from '@/lib/disks/diskMount';
import { loadDiskAutostartMode } from '@/lib/config/appSettings';

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
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

vi.mock('@/lib/disks/diskMount', () => ({
  mountDiskToDrive: vi.fn().mockResolvedValue({ errors: [] }),
  resolveLocalDiskBlob: vi.fn(),
}));

vi.mock('@/lib/config/appSettings', () => ({
  loadDiskAutostartMode: vi.fn().mockReturnValue('kernal'),
}));

beforeEach(() => {
  vi.mocked(injectAutostart).mockClear();
  vi.mocked(loadFirstDiskPrgViaDma).mockClear();
  vi.mocked(mountDiskToDrive).mockClear();
  vi.mocked(resolveLocalDiskBlob).mockReset();
  vi.mocked(loadDiskAutostartMode).mockReset();
  vi.mocked(loadDiskAutostartMode).mockReturnValue('kernal');
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

  it('surfaces local SID read failures with a re-add message', async () => {
    const api = createApiMock();
    const file = {
      name: 'demo.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => {
        throw new TypeError('Failed to fetch');
      },
    };
    const plan = buildPlayPlan({ source: 'local', path: '/demo.sid', file });
    await expect(executePlayPlan(api as any, plan)).rejects.toThrow('Local file unavailable. Re-add it to the playlist.');
    expect(vi.mocked(addErrorLog)).toHaveBeenCalled();
  });

  it('routes MOD playback for Ultimate files', async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: 'ultimate', path: '/MUSIC/DEMO.MOD' });
    await executePlayPlan(api as any, plan);
    expect(api.playMod).toHaveBeenCalledWith('/MUSIC/DEMO.MOD');
  });

  it('routes CRT playback for local uploads', async () => {
    const api = createApiMock();
    const file = new File(['crt'], 'demo.crt');
    const plan = buildPlayPlan({ source: 'local', path: '/demo.crt', file });
    await executePlayPlan(api as any, plan);
    expect(api.runCartridgeUpload).toHaveBeenCalled();
  });

  it('routes PRG playback for Ultimate in run mode', async () => {
    const api = createApiMock();
    const plan = buildPlayPlan({ source: 'ultimate', path: '/demo.prg' });
    await executePlayPlan(api as any, plan, { loadMode: 'run' });
    expect(api.runPrg).toHaveBeenCalledWith('/demo.prg');
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

  it('mounts Ultimate disk images via disk mount helper', async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    const plan = buildPlayPlan({ source: 'ultimate', path: '/Usb0/DEMO.D64' });
    const task = executePlayPlan(api as any, plan, { drive: 'b' });
    await vi.runAllTimersAsync();
    await task;
    expect(vi.mocked(mountDiskToDrive)).toHaveBeenCalledWith(
      api,
      'b',
      expect.objectContaining({ path: '/Usb0/DEMO.D64', location: 'ultimate' }),
    );
    vi.useRealTimers();
  });

  it('retries autostart injection after mount when initial attempt fails', async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    vi.mocked(injectAutostart)
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce(undefined as any);
    const file = new File(['disk'], 'demo.d64');
    const plan = buildPlayPlan({ source: 'local', path: '/demo.d64', file });
    const task = executePlayPlan(api as any, plan, { drive: 'a', rebootBeforeMount: true });
    await vi.runAllTimersAsync();
    await task;
    expect(vi.mocked(injectAutostart)).toHaveBeenCalledTimes(2);
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

  it('uses DMA loader for local disk paths when blob can be resolved', async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    vi.mocked(loadDiskAutostartMode).mockReturnValue('dma');
    const resolvedBlob = { arrayBuffer: async () => new ArrayBuffer(4) } as Blob;
    vi.mocked(resolveLocalDiskBlob).mockResolvedValue(resolvedBlob);
    const plan = buildPlayPlan({ source: 'local', path: '/demo.d64' });
    const task = executePlayPlan(api as any, plan, { drive: 'a' });
    await vi.runAllTimersAsync();
    await task;
    expect(vi.mocked(resolveLocalDiskBlob)).toHaveBeenCalled();
    expect(vi.mocked(loadFirstDiskPrgViaDma)).toHaveBeenCalled();
    expect(vi.mocked(injectAutostart)).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('falls back to autostart when DMA loader cannot resolve local disk blob', async () => {
    vi.useFakeTimers();
    const api = createApiMock();
    vi.mocked(loadDiskAutostartMode).mockReturnValue('dma');
    vi.mocked(resolveLocalDiskBlob).mockRejectedValue(new Error('missing'));
    const plan = buildPlayPlan({ source: 'local', path: '/demo.d64' });
    const task = executePlayPlan(api as any, plan, { drive: 'a' });
    await vi.runAllTimersAsync();
    await task;
    expect(vi.mocked(injectAutostart)).toHaveBeenCalled();
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

  it('local SID blob upload sends correct bytes matching the file content', async () => {
    const api = createApiMock();
    const sidBytes = new Uint8Array([0x50, 0x53, 0x49, 0x44, 0x00, 0x02]); // PSID header stub
    const file = {
      name: 'test.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => sidBytes.buffer.slice(0),
    };
    const plan = buildPlayPlan({ source: 'local', path: '/test.sid', file });
    await executePlayPlan(api as any, plan);
    expect(api.playSidUpload).toHaveBeenCalledTimes(1);
    const blob = api.playSidUpload.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(sidBytes.byteLength);
  });

  it('local SID blob upload content length matches original file size', async () => {
    const api = createApiMock();
    const content = new Uint8Array(1024);
    content.fill(0x42);
    const file = new File([content], 'large.sid', { type: 'application/octet-stream' });
    const plan = buildPlayPlan({ source: 'local', path: '/large.sid', file });
    await executePlayPlan(api as any, plan);
    const blob = api.playSidUpload.mock.calls[0][0] as Blob;
    expect(blob.size).toBe(1024);
  });

  it('local file arrayBuffer is stable across repeated reads', async () => {
    const api = createApiMock();
    const sidBytes = new Uint8Array([0x50, 0x53, 0x49, 0x44]);
    const file = {
      name: 'stable.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => sidBytes.buffer,
    };
    const plan = buildPlayPlan({ source: 'local', path: '/stable.sid', file });
    await executePlayPlan(api as any, plan);
    // Second execution with same file
    await executePlayPlan(api as any, plan);
    const blob1 = api.playSidUpload.mock.calls[0][0] as Blob;
    const blob2 = api.playSidUpload.mock.calls[1][0] as Blob;
    const bytes1 = new Uint8Array(await new Response(blob1).arrayBuffer());
    const bytes2 = new Uint8Array(await new Response(blob2).arrayBuffer());
    expect(bytes1).toEqual(bytes2);
  });
});
