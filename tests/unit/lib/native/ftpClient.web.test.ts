import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FtpClientWeb } from '@/lib/native/ftpClient.web';

vi.mock('@/lib/ftp/ftpConfig', () => ({
    getFtpBridgeUrl: vi.fn(() => 'http://bridge.local'),
}));

describe('FtpClientWeb retry policy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('retries timeout failures and eventually succeeds for listDirectory', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error('FTP bridge request timed out'))
            .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ name: 'demo.sid', path: '/demo.sid', type: 'file' }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        const client = new FtpClientWeb();
        const result = await client.listDirectory({ host: 'c64u' });

        expect(result.entries).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries HTTP 5xx responses and succeeds for readFile', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'upstream unavailable' }), {
                status: 503,
                headers: { 'content-type': 'application/json' },
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: 'QQ==', sizeBytes: 1 }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        const client = new FtpClientWeb();
        const result = await client.readFile({ host: 'c64u', path: '/songlengths.md5' });

        expect(result.data).toBe('QQ==');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry HTTP 4xx responses', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ error: 'bad request' }), {
                status: 400,
                headers: { 'content-type': 'application/json' },
            }),
        );
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        const client = new FtpClientWeb();
        await expect(client.listDirectory({ host: 'c64u' })).rejects.toThrow('bad request');

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fails after max retry attempts for repeated transient failures', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error('network failed to fetch'));
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        const client = new FtpClientWeb();
        await expect(client.readFile({ host: 'c64u', path: '/demo.sid' })).rejects.toThrow('network failed to fetch');

        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
