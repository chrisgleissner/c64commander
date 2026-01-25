import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildHvscBaselineUrl,
  buildHvscUpdateUrl,
  fetchLatestHvscVersions,
} from '@/lib/hvsc/hvscReleaseService';

describe('hvscReleaseService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('parses latest baseline and update versions', async () => {
    const html = `
      <html>
        <a href="HVSC_83-all-of-them.7z">HVSC_83-all-of-them.7z</a>
        <a href="HVSC_84-all-of-them.7z">HVSC_84-all-of-them.7z</a>
        <a href="HVSC_Update_84.7z">HVSC_Update_84.7z</a>
        <a href="HVSC_Update_85.7z">HVSC_Update_85.7z</a>
      </html>
    `;

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(html, { status: 200 }));

    const result = await fetchLatestHvscVersions('https://example.com/hvsc/');
    expect(result).toEqual({
      baselineVersion: 84,
      updateVersion: 85,
      baseUrl: 'https://example.com/hvsc/',
    });
    expect(buildHvscBaselineUrl(84, result.baseUrl)).toBe('https://example.com/hvsc/HVSC_84-all-of-them.7z');
    expect(buildHvscUpdateUrl(85, result.baseUrl)).toBe('https://example.com/hvsc/HVSC_Update_85.7z');
  });

  it('defaults update version to baseline when none found', async () => {
    const html = `
      <html>
        <a href="HVSC_82-all-of-them.7z">HVSC_82-all-of-them.7z</a>
      </html>
    `;

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(html, { status: 200 }));

    const result = await fetchLatestHvscVersions('https://example.com/hvsc/');
    expect(result.baselineVersion).toBe(82);
    expect(result.updateVersion).toBe(82);
  });

  it('throws on non-ok response', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' }));

    await expect(fetchLatestHvscVersions('https://example.com/hvsc/')).rejects.toThrow(
      'HVSC release fetch failed: 500 Server Error',
    );
  });
});
