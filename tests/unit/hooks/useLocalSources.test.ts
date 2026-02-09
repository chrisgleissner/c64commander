import { renderHook, act } from '@testing-library/react';
import { useLocalSources } from '@/hooks/useLocalSources';
import {
  createLocalSourceFromFileList,
  createLocalSourceFromPicker,
  loadLocalSources,
  saveLocalSources,
  setLocalSourceRuntimeFiles,
} from '@/lib/sourceNavigation/localSourcesStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sourceNavigation/localSourcesStore', () => ({
  createLocalSourceFromFileList: vi.fn(),
  createLocalSourceFromPicker: vi.fn(),
  loadLocalSources: vi.fn().mockReturnValue([]),
  saveLocalSources: vi.fn(),
  setLocalSourceRuntimeFiles: vi.fn(),
}));

describe('useLocalSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadLocalSources).mockReturnValue([]);
  });

  it('initializes with stored sources', () => {
    vi.mocked(loadLocalSources).mockReturnValue([{ id: 'stored', name: 'Stored' }] as any);
    const { result } = renderHook(() => useLocalSources());
    expect(result.current.sources).toHaveLength(1);
    expect(result.current.sources[0].id).toBe('stored');
  });

  it('adds source from picker', async () => {
    const { result } = renderHook(() => useLocalSources());
    const input = document.createElement('input');
    
    vi.mocked(createLocalSourceFromPicker).mockResolvedValue({
      source: { id: 'picker', name: 'Picker' } as any,
      runtimeFiles: {},
    });

    await act(async () => {
      await result.current.addSourceFromPicker(input);
    });

    expect(result.current.sources).toHaveLength(1);
    expect(result.current.sources[0].id).toBe('picker');
    expect(setLocalSourceRuntimeFiles).toHaveBeenCalled();
    expect(saveLocalSources).toHaveBeenCalled();
  });
  
  it('handles null picker input', async () => {
      const { result } = renderHook(() => useLocalSources());
      vi.mocked(createLocalSourceFromPicker).mockResolvedValue(null);
      await act(async () => {
          const res = await result.current.addSourceFromPicker(null);
          expect(res).toBeNull();
      });
      expect(result.current.sources).toHaveLength(0);
  });

  it('adds source from files', () => {
    const { result } = renderHook(() => useLocalSources());
    const files = [new File([], 'test.d64')];
    
    vi.mocked(createLocalSourceFromFileList).mockReturnValue({
      source: { id: 'files', name: 'Files' } as any,
      runtimeFiles: {},
    });

    act(() => {
      result.current.addSourceFromFiles(files);
    });

    expect(result.current.sources).toHaveLength(1);
    expect(result.current.sources[0].id).toBe('files');
  });

  it('handles empty files', () => {
    const { result } = renderHook(() => useLocalSources());
    act(() => {
        const res = result.current.addSourceFromFiles([]);
        expect(res).toBeNull();
    });
    expect(result.current.sources).toHaveLength(0);
  });

  it('removes source', () => {
    const { result } = renderHook(() => useLocalSources());
    
    // Setup initial state via addSourceFromFiles for simplicity
    vi.mocked(createLocalSourceFromFileList).mockReturnValue({
      source: { id: 'files', name: 'Files' } as any,
      runtimeFiles: {},
    });
    act(() => {
      result.current.addSourceFromFiles([new File([], 'f')]);
    });
    expect(result.current.sources).toHaveLength(1);

    act(() => {
      result.current.removeSource('files');
    });

    expect(result.current.sources).toHaveLength(0);
  });
  
  it('replaces sources', () => {
    const { result } = renderHook(() => useLocalSources());
    const newSources = [{ id: 'new', name: 'New' }] as any;
    
    act(() => {
        result.current.replaceSources(newSources);
    });
    
    expect(result.current.sources).toEqual(newSources);
    expect(saveLocalSources).toHaveBeenCalledWith(newSources);
  });
});
