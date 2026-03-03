import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockStartStream = vi.fn();
const mockStopStream = vi.fn();

vi.mock('@/lib/c64api', () => ({
    getC64API: () => ({ startStream: mockStartStream, stopStream: mockStopStream }),
}));

vi.mock('@/hooks/useC64Connection', () => ({
    useC64ConfigItems: vi.fn().mockReturnValue({ data: undefined }),
}));

vi.mock('@/hooks/useActionTrace', () => ({
    useActionTrace: () => {
        const trace = <T extends (...args: never[]) => unknown>(fn: T) => fn;
        trace.scope = async (_name: string, fn: () => Promise<unknown>) => fn();
        return trace;
    },
}));

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
    toast: (...args: unknown[]) => mockToast(...args),
}));

const mockReportUserError = vi.fn();
vi.mock('@/lib/uiErrors', () => ({
    reportUserError: (...args: unknown[]) => mockReportUserError(...args),
}));

import { useC64ConfigItems } from '@/hooks/useC64Connection';
import { useStreamData } from '@/pages/home/hooks/useStreamData';
import type { StreamKey } from '@/lib/config/homeStreams';

const mockedUseC64ConfigItems = vi.mocked(useC64ConfigItems);

const defaultProps = {
    isConnected: true,
    configWritePending: {} as Record<string, boolean>,
    updateConfigValue: vi.fn().mockResolvedValue(undefined),
};

/** Helper: provide stream config data so buildStreamControlEntries yields real entries */
const withStreamConfig = (ip = '192.168.1.10', port = '11000') => {
    mockedUseC64ConfigItems.mockReturnValue({
        data: {
            'Stream VIC to': { value: `${ip}:${port}` },
            'Stream Audio to': { value: `${ip}:11001` },
            'Stream Debug to': { value: `${ip}:11002` },
        },
    } as never);
};

describe('useStreamData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedUseC64ConfigItems.mockReturnValue({ data: undefined } as never);
        defaultProps.updateConfigValue = vi.fn().mockResolvedValue(undefined);
    });

    // 1. Returns initial empty stream state
    it('returns initial empty stream state when no config data', () => {
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        expect(result.current.streamControlEntries).toHaveLength(3);
        expect(result.current.activeStreamEditorKey).toBeNull();
        expect(result.current.streamEditorError).toBeNull();
        expect(result.current.streamActionPending).toEqual({});
    });

    // 2. handleStreamFieldChange updates draft endpoint/ip/port
    it('handleStreamFieldChange updates draft', () => {
        withStreamConfig();
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        act(() => {
            result.current.handleStreamFieldChange('vic', '10.0.0.1:9000');
        });

        expect(result.current.streamDrafts['vic']).toEqual({
            ip: '10.0.0.1',
            port: '9000',
            endpoint: '10.0.0.1:9000',
        });
    });

    // 3. handleStreamEditOpen populates drafts from entry
    it('handleStreamEditOpen populates drafts from entry', () => {
        withStreamConfig('192.168.1.10', '11000');
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        act(() => {
            result.current.handleStreamEditOpen('vic');
        });

        expect(result.current.activeStreamEditorKey).toBe('vic');
        expect(result.current.streamDrafts['vic']).toEqual({
            ip: '192.168.1.10',
            port: '11000',
            endpoint: '192.168.1.10:11000',
        });
    });

    // 4. handleStreamEditCancel resets draft to entry values
    it('handleStreamEditCancel resets draft to entry values', () => {
        withStreamConfig('192.168.1.10', '11000');
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        act(() => {
            result.current.handleStreamEditOpen('vic');
        });
        act(() => {
            result.current.handleStreamFieldChange('vic', '10.0.0.99:5555');
        });
        act(() => {
            result.current.handleStreamEditCancel('vic');
        });

        expect(result.current.activeStreamEditorKey).toBeNull();
        expect(result.current.streamDrafts['vic']).toEqual({
            ip: '192.168.1.10',
            port: '11000',
            endpoint: '192.168.1.10:11000',
        });
    });

    // 5. handleStreamStart with valid endpoint calls api.startStream
    it('handleStreamStart with valid endpoint calls api.startStream', async () => {
        withStreamConfig('192.168.1.10', '11000');
        mockStartStream.mockResolvedValue(undefined);
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        await act(async () => {
            await result.current.handleStreamStart('vic');
        });

        expect(mockStartStream).toHaveBeenCalledWith('video', '192.168.1.10:11000');
        expect(mockToast).toHaveBeenCalledWith({ title: 'VIC start command sent' });
    });

    // 6. handleStreamStart with invalid host shows error
    it('handleStreamStart with invalid host shows error', async () => {
        withStreamConfig('192.168.1.10', '11000');
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        act(() => {
            result.current.handleStreamFieldChange('vic', 'not-an-ip:11000');
        });

        await act(async () => {
            await result.current.handleStreamStart('vic');
        });

        expect(mockStartStream).not.toHaveBeenCalled();
        expect(mockReportUserError).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'STREAM_VALIDATE', title: 'Invalid stream target' }),
        );
        expect(result.current.streamEditorError).toBeTruthy();
    });

    // 7. handleStreamStart with invalid port shows error
    it('handleStreamStart with invalid port shows error', async () => {
        withStreamConfig('192.168.1.10', '11000');
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        act(() => {
            result.current.handleStreamFieldChange('vic', '192.168.1.10:99999');
        });

        await act(async () => {
            await result.current.handleStreamStart('vic');
        });

        expect(mockStartStream).not.toHaveBeenCalled();
        expect(mockReportUserError).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'STREAM_VALIDATE' }),
        );
        expect(result.current.streamEditorError).toBeTruthy();
    });

    // 8. handleStreamStop calls api.stopStream
    it('handleStreamStop calls api.stopStream', async () => {
        withStreamConfig();
        mockStopStream.mockResolvedValue(undefined);
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        await act(async () => {
            await result.current.handleStreamStop('vic');
        });

        expect(mockStopStream).toHaveBeenCalledWith('video');
        expect(mockToast).toHaveBeenCalledWith({ title: 'VIC stop command sent' });
    });

    // 9. handleStreamStop error path reports user error
    it('handleStreamStop error path reports user error', async () => {
        withStreamConfig();
        mockStopStream.mockRejectedValue(new Error('network failure'));
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        await act(async () => {
            await result.current.handleStreamStop('vic');
        });

        expect(mockReportUserError).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'STREAM_STOP', title: 'Stream stop failed' }),
        );
    });

    // 10. handleStreamStart error path reports user error
    it('handleStreamStart error path reports user error', async () => {
        withStreamConfig();
        mockStartStream.mockRejectedValue(new Error('connection refused'));
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        await act(async () => {
            await result.current.handleStreamStart('vic');
        });

        expect(mockReportUserError).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'STREAM_START', title: 'Stream start failed' }),
        );
    });

    // 11. handleStreamCommit with valid endpoint calls updateConfigValue
    it('handleStreamCommit with valid endpoint calls updateConfigValue', async () => {
        withStreamConfig('192.168.1.10', '11000');
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        act(() => {
            result.current.handleStreamEditOpen('vic');
        });
        act(() => {
            result.current.handleStreamFieldChange('vic', '10.0.0.5:8000');
        });

        let committed: boolean | undefined;
        await act(async () => {
            committed = await result.current.handleStreamCommit('vic');
        });

        expect(committed).toBe(true);
        expect(defaultProps.updateConfigValue).toHaveBeenCalledWith(
            'Data Streams',
            'Stream VIC to',
            '10.0.0.5:8000',
            'HOME_STREAM_UPDATE',
            'VIC stream target updated',
        );
        expect(result.current.activeStreamEditorKey).toBeNull();
    });

    // 12. handleStreamCommit with invalid host returns false
    it('handleStreamCommit with invalid host returns false', async () => {
        withStreamConfig();
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        act(() => {
            result.current.handleStreamEditOpen('vic');
        });
        act(() => {
            result.current.handleStreamFieldChange('vic', 'bad-host:8000');
        });

        let committed: boolean | undefined;
        await act(async () => {
            committed = await result.current.handleStreamCommit('vic');
        });

        expect(committed).toBe(false);
        expect(mockReportUserError).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'STREAM_VALIDATE', title: 'Invalid stream host' }),
        );
        expect(result.current.streamEditorError).toBeTruthy();
    });

    // 13. handleStreamCommit with invalid port returns false
    it('handleStreamCommit with invalid port returns false', async () => {
        withStreamConfig();
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        act(() => {
            result.current.handleStreamEditOpen('vic');
        });
        act(() => {
            result.current.handleStreamFieldChange('vic', '192.168.1.10:99999');
        });

        let committed: boolean | undefined;
        await act(async () => {
            committed = await result.current.handleStreamCommit('vic');
        });

        expect(committed).toBe(false);
        expect(mockReportUserError).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'STREAM_VALIDATE', title: 'Invalid stream port' }),
        );
        expect(result.current.streamEditorError).toBeTruthy();
    });

    // 14. handleStreamCommit with parse error returns false
    it('handleStreamCommit with parse error returns false', async () => {
        withStreamConfig();
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        act(() => {
            result.current.handleStreamEditOpen('vic');
        });
        // Set an endpoint that will fail parseStreamEndpoint (no colon separator)
        act(() => {
            result.current.handleStreamFieldChange('vic', 'no-separator');
        });

        let committed: boolean | undefined;
        await act(async () => {
            committed = await result.current.handleStreamCommit('vic');
        });

        expect(committed).toBe(false);
        expect(mockReportUserError).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'STREAM_VALIDATE', title: 'Invalid stream endpoint' }),
        );
        expect(result.current.streamEditorError).toBeTruthy();
    });

    // 15. handleStreamStart with no matching entry returns early
    it('handleStreamStart with no matching entry returns early', async () => {
        withStreamConfig();
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        await act(async () => {
            await result.current.handleStreamStart('nonexistent' as StreamKey);
        });

        expect(mockStartStream).not.toHaveBeenCalled();
    });

    // 16. handleStreamStop with no matching entry returns early (BRDA:109)
    it('handleStreamStop with no matching entry returns early', async () => {
        withStreamConfig();
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        await act(async () => {
            await result.current.handleStreamStop('nonexistent' as StreamKey);
        });

        expect(mockStopStream).not.toHaveBeenCalled();
    });

    // 17. handleStreamEditOpen with no matching entry returns early (BRDA:148)
    it('handleStreamEditOpen with no matching entry is a no-op', () => {
        withStreamConfig();
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        act(() => {
            result.current.handleStreamEditOpen('nonexistent' as StreamKey);
        });

        expect(result.current.activeStreamEditorKey).toBeNull();
    });

    // 18. handleStreamEditCancel when key differs from active editor keeps active editor (BRDA:174)
    it('handleStreamEditCancel keeps active editor when canceling a different key', () => {
        withStreamConfig();
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        // Open 'vic' editor
        act(() => {
            result.current.handleStreamEditOpen('vic');
        });
        expect(result.current.activeStreamEditorKey).toBe('vic');

        // Cancel 'audio' (different from active 'vic') → active stays 'vic'
        act(() => {
            result.current.handleStreamEditCancel('audio');
        });
        expect(result.current.activeStreamEditorKey).toBe('vic');
    });

    // 19. handleStreamCommit with no matching entry returns false (BRDA:179)
    it('handleStreamCommit with no matching entry returns false', async () => {
        withStreamConfig();
        const { result } = renderHook(() =>
            useStreamData(defaultProps.isConnected, defaultProps.configWritePending, defaultProps.updateConfigValue),
        );

        let committed: boolean | undefined;
        await act(async () => {
            committed = await result.current.handleStreamCommit('nonexistent' as StreamKey);
        });

        expect(committed).toBe(false);
    });
});
