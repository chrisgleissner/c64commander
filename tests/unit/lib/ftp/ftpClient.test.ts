import { listFtpDirectory, readFtpFile } from '@/lib/ftp/ftpClient';
import { FtpClient } from '@/lib/native/ftpClient';
import { withFtpInteraction } from '@/lib/deviceInteraction/deviceInteractionManager';
import { getActiveAction, runWithImplicitAction } from '@/lib/tracing/actionTrace';
import { recordFtpOperation, recordTraceError } from '@/lib/tracing/traceSession';
import { decrementFtpInFlight, incrementFtpInFlight } from '@/lib/diagnostics/diagnosticsActivity';
import { addErrorLog } from '@/lib/logging';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/native/ftpClient', () => ({
  FtpClient: {
    listDirectory: vi.fn(),
    readFile: vi.fn(),
  },
}));
vi.mock('@/lib/deviceInteraction/deviceInteractionManager', () => ({
  withFtpInteraction: vi.fn(async (_ctx, fn) => fn()),
}));
vi.mock('@/lib/tracing/actionTrace', () => ({
  getActiveAction: vi.fn(),
  runWithImplicitAction: vi.fn(async (_name, fn) => fn({ id: 'implicit-action' })),
}));
vi.mock('@/lib/tracing/traceSession');
vi.mock('@/lib/diagnostics/diagnosticsActivity');
vi.mock('@/lib/logging');

describe('ftpClient', () => {
    const mockHost = '192.168.1.64';
    const mockListOptions = { host: mockHost, port: 21, user: 'root', password: '' };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('listFtpDirectory', () => {
        it('lists directory successfully', async () => {
            const mockEntries = [{ name: 'test.d64', type: 1, size: 1024 }];
            vi.mocked(FtpClient.listDirectory).mockResolvedValue({ entries: mockEntries } as any);

            const result = await listFtpDirectory({ ...mockListOptions, path: '/some/path' });

            expect(result.path).toBe('/some/path');
            expect(result.entries).toEqual(mockEntries);
            
            expect(incrementFtpInFlight).toHaveBeenCalled();
            expect(decrementFtpInFlight).toHaveBeenCalled();
            expect(recordFtpOperation).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ result: 'success' })
            );
        });

        it('handles list failure', async () => {
             const error = new Error('FTP Error');
             vi.mocked(FtpClient.listDirectory).mockRejectedValue(error);

             await expect(listFtpDirectory({ ...mockListOptions, path: '/' }))
                .rejects.toThrow('FTP Error');

            expect(addErrorLog).toHaveBeenCalled();
            expect(recordTraceError).toHaveBeenCalled();
            expect(decrementFtpInFlight).toHaveBeenCalled();
        });

        it('uses existing active action if available', async () => {
            const mockAction = { id: 'active' };
            vi.mocked(getActiveAction).mockReturnValue(mockAction as any);
            vi.mocked(FtpClient.listDirectory).mockResolvedValue({ entries: [] });

            await listFtpDirectory({ ...mockListOptions });

            expect(runWithImplicitAction).not.toHaveBeenCalled();
            expect(recordFtpOperation).toHaveBeenCalledWith(
                mockAction,
                expect.anything()
            );
        });
    });

    describe('readFtpFile', () => {
        const mockReadOptions = { ...mockListOptions, path: '/test.txt' };

        it('reads file successfully', async () => {
             const mockResponse = { data: 'content', sizeBytes: 7 };
             vi.mocked(FtpClient.readFile).mockResolvedValue(mockResponse);

             const result = await readFtpFile(mockReadOptions);
             
             expect(result).toBe(mockResponse);
             expect(incrementFtpInFlight).toHaveBeenCalled();
             expect(recordFtpOperation).toHaveBeenCalledWith(
                 expect.anything(),
                 expect.objectContaining({ operation: 'read', result: 'success' })
             );
        });

        it('handles read failure', async () => {
             vi.mocked(FtpClient.readFile).mockRejectedValue(new Error('Read failed'));

             await expect(readFtpFile(mockReadOptions)).rejects.toThrow('Read failed');
             
             expect(addErrorLog).toHaveBeenCalled();
             expect(recordTraceError).toHaveBeenCalled();
        });
    });
});
