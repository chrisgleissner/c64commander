
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSonglengths } from '@/pages/playFiles/hooks/useSonglengths';
import { type LocalPlayFile } from '@/lib/playback/playbackRouter';

// Mocks
vi.mock('@/hooks/use-toast', () => ({
    toast: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
    addErrorLog: vi.fn()
}));

// Mock songlengths library
vi.mock('@/lib/songlengths', () => ({
    SongLengthServiceFacade: class {
        constructor() { }
        loadOnColdStart() { return Promise.resolve({ status: 'ready' }); }
    },
    InMemoryTextBackend: class {
        constructor() { }
        exportSnapshot() { return {}; }
    },
}));

vi.mock('@/lib/sid/songlengths', () => ({
    countSonglengthsEntries: () => 42,
    parseSongLengthsFile: () => Promise.resolve([]),
}));

vi.mock('@/lib/playback/fileLibraryUtils', () => ({
    buildLocalPlayFileFromUri: (name: string, path: string, uri: string) => {
        // Mock file object with necessary methods
        const blob = new Blob([''], { type: 'text/plain' });
        const file = new File([blob], name, { lastModified: 1000 }) as unknown as LocalPlayFile;
        // Ensure arrayBuffer and text are mocked if needed, but File has them in newer jsdom
        return file;
    }
}));


describe('useSonglengths', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('initializes defaults', () => {
        const { result } = renderHook(() => useSonglengths({ playlist: [] }));
        expect(result.current.songlengthsFiles).toEqual([]);
    });

    it('handles songlengths input', async () => {
        const { result } = renderHook(() => useSonglengths({ playlist: [] }));

        const file = new File(['md5=123'], 'Songlengths.txt', { type: 'text/plain' });
        // Mock arrayBuffer/text if missing in environment
        if (!file.text) {
            // @ts-expect-error - polyfilling text() for test environment
            file.text = async () => 'md5=123';
            // @ts-expect-error - polyfilling arrayBuffer() for test environment
            file.arrayBuffer = async () => new TextEncoder().encode('md5=123').buffer;
        }

        act(() => {
            // @ts-expect-error - passing File[] instead of FileList for test
            result.current.handleSonglengthsInput([file]);
        });

        expect(result.current.songlengthsFiles).toHaveLength(1);
        expect(result.current.songlengthsFiles[0].name).toBe('Songlengths.txt');

        await waitFor(() => {
            expect(result.current.songlengthsSummary.entryCount).toBe(42);
        });
    });

    it('handles picked file persistence', () => {
        const { result } = renderHook(() => useSonglengths({ playlist: [] }));

        act(() => {
            result.current.handleSonglengthsPicked({
                uri: 'file://sl.txt',
                name: 'Songlengths.txt',
                path: '/Songlengths.txt'
            });
        });

        expect(localStorage.getItem('c64u_songlengths_file:v1')).toContain('file://sl.txt');
    });

    it('ignores invalid file types', () => {
        const { result } = renderHook(() => useSonglengths({ playlist: [] }));
        const file = new File([''], 'readme.md', { type: 'text/plain' });
        act(() => {
            // @ts-expect-error - passing File[] instead of FileList for test
            result.current.handleSonglengthsInput([file]);
        });
        // Should ignore
        expect(result.current.songlengthsFiles).toHaveLength(0);
    });
});
