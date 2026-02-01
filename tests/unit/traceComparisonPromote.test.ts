import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { compareOrPromoteTraceFiles } from '../../playwright/traceComparison.js';

describe('compareOrPromoteTraceFiles', () => {
  const originalEnv = { ...process.env };
  let tmpRoot: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'c64commander-traces-'));
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('promotes evidence trace.json when golden is missing', async () => {
    const goldenDir = path.join(tmpRoot, 'golden');
    const evidenceDir = path.join(tmpRoot, 'evidence');
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.writeFile(path.join(evidenceDir, 'trace.json'), JSON.stringify([{ id: 'EVT-0000' }]), 'utf8');

    const result = await compareOrPromoteTraceFiles(goldenDir, evidenceDir);
    expect(result.promoted).toBe(true);
    expect(result.errors).toEqual([]);

    const promoted = await fs.readFile(path.join(goldenDir, 'trace.json'), 'utf8');
    expect(promoted).toContain('EVT-0000');
  });
});
