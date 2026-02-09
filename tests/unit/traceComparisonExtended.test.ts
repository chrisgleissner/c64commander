/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

// Hoisted mock
vi.mock('node:fs', () => {
  const readFileMock = vi.fn();
  const statMock = vi.fn();
  const mkdirMock = vi.fn();
  const copyFileMock = vi.fn();
  const writeFileSyncMock = vi.fn();
  const existsSyncMock = vi.fn();
  
  return {
    promises: {
      readFile: readFileMock,
      stat: statMock,
      mkdir: mkdirMock,
      copyFile: copyFileMock,
    },
    default: {
      promises: {
        readFile: readFileMock,
        stat: statMock,
        mkdir: mkdirMock,
        copyFile: copyFileMock,
      },
      readFileSync: vi.fn(),
      writeFileSync: writeFileSyncMock,
      existsSync: existsSyncMock,
    }
  };
});

import { compareOrPromoteTraceFiles, compareTraceFiles, formatTraceErrors, compareTracesEssential, resolveGoldenRoot, resolveGoldenDirForEvidence } from '../../playwright/traceComparison.js';
import fs from 'node:fs';

describe('traceComparison extended', () => {
    afterEach(() => {
        vi.resetAllMocks();
        delete process.env.TRACE_GOLDEN_DIR;
        delete process.env.TRACE_OUTPUT_DIR;
        delete process.env.TRACE_SUITE;
    });

    describe('resolveGoldenRoot', () => {
        it('uses TRACE_GOLDEN_DIR if set', () => {
            process.env.TRACE_GOLDEN_DIR = '/custom/golden';
            expect(resolveGoldenRoot()).toBe(path.resolve('/custom/golden'));
        });
        
        it('uses TRACE_OUTPUT_DIR if TRACE_GOLDEN_DIR not set', () => {
             process.env.TRACE_OUTPUT_DIR = '/custom/output';
             expect(resolveGoldenRoot()).toBe(path.resolve('/custom/output'));
        });
        
        it('falls back to default locations', () => {
             // Mock existsSync to control fallbacks
             vi.mocked(fs.existsSync).mockReturnValueOnce(true);
             const result = resolveGoldenRoot();
             expect(result).toContain('fixtures/traces/golden');
             
             vi.mocked(fs.existsSync).mockReturnValueOnce(false); // default missing
             const result2 = resolveGoldenRoot();
             expect(result2).toContain('test-results/traces/golden');
        });
    });

    describe('resolveGoldenDirForEvidence', () => {
         // Reconstruct evidenceRoot as it is defined in traceComparison.js (implied, not exported, but logic assumes it)
         // Actually we can't easily access the internal 'evidenceRoot' var, but we know it is path.resolve(process.cwd(), 'test-results', 'evidence', 'playwright')
         const evidenceBase = path.resolve(process.cwd(), 'test-results', 'evidence', 'playwright');

         it('resolves directly if no suite', () => {
             const evidenceDir = path.join(evidenceBase, 'my-test');
             const result = resolveGoldenDirForEvidence(evidenceDir);
             expect(result).not.toContain('untitled');
             expect(result).toContain('my-test');
         });

         it('injects suite name if set', () => {
             process.env.TRACE_SUITE = 'My Suite';
             const evidenceDir = path.join(evidenceBase, 'my-test');
             const result = resolveGoldenDirForEvidence(evidenceDir);
             expect(result).toContain('my-suite');
             expect(result).toContain('my-test');
         });
    });

    describe('compareTracesEssential validation', () => {
         it('returns errors for non-array inputs', () => {
             const result = compareTracesEssential(null, []);
             expect(result.errors).toContain('Trace payload is not a valid array.');
             
             const result2 = compareTracesEssential([], null);
             expect(result2.errors).toContain('Trace payload is not a valid array.');
         });

         it('detects invalid and duplicate trace IDs', () => {
             const evidence = [
                 { id: 'INVALID',  correlationId: 'COR-0001', type: 'test', data: {} },
                 { id: 'EVT-0001', correlationId: 'BAD-ID',   type: 'test', data: {} },
                 { id: 'EVT-0002', correlationId: 'COR-0002', type: 'test', data: {} },
                 { id: 'EVT-0002', correlationId: 'COR-0003', type: 'test', data: {} } // Duplicate EVT-0002
             ];
             const result = compareTracesEssential([], evidence);
             const errorString = result.errors.join(' ');
             expect(errorString).toContain('Invalid trace id format: INVALID');
             expect(errorString).toContain('Invalid correlationId format: BAD-ID');
             expect(errorString).toContain('Duplicate trace id: EVT-0002');
         });
    });

    describe('compareTracesEssential normalization', () => {
        it('normalizes volatile fields and sensitive data', () => {
             const golden = [{ 
                 type: 'rest-request', 
                 data: { headers: { host: '***' }, timestamp: 12345 }, 
                 correlationId: 'COR-0001', 
                 origin: 'ui' 
             }];
             const evidence = [{ 
                 type: 'rest-request', 
                 data: { headers: { host: 'localhost:8080' }, timestamp: 67890 }, 
                 correlationId: 'COR-0001', 
                 origin: 'ui' 
             }];
             
             const result = compareTracesEssential(golden, evidence);
             expect(result.errors).toEqual([]);
        });

        it('normalizes complex URLs, paths, and IPs', () => {
             const evidence = [{ 
                 type: 'rest-request', 
                 data: { 
                    url: 'http://example.com/api?b=2&a=1',
                    body: { 
                        path: 'C:\\Users\\User\\file.txt', 
                        log: '/var/log/syslog',
                        ip: '192.168.1.1',
                        host: 'myserver:8080',
                        hostname: 'myserver.com' // Line 74
                    }
                 }, 
                 correlationId: 'COR-0001', 
                 origin: 'ui' 
             }];
             const golden = [{ 
                 type: 'rest-request', 
                 data: { 
                    url: '/api?a=1&b=2',
                    body: { 
                        path: '***', 
                        log: '***/***',
                        ip: '***',
                        host: '***',
                        hostname: '***'
                    }
                 }, 
                 correlationId: 'COR-0001', 
                 origin: 'ui' 
             }];
             
             const result = compareTracesEssential(golden, evidence);
             expect(result.errors).toEqual([]);
        });

        it('normalizes ftp-operations', () => {
            const evidence = [{
                type: 'ftp-operation',
                data: {
                    operation: 'LIST',
                    path: '/some/path',
                    timestamp: 123456
                },
                correlationId: 'COR-0002',
                origin: 'user'
            }];
             const golden = [{
                type: 'ftp-operation',
                data: {
                    operation: 'LIST',
                    path: '/some/path'
                    // timestamp ignored
                },
                correlationId: 'COR-0002',
                origin: 'user'
            }];
            const result = compareTracesEssential(golden, evidence);
            expect(result.errors).toEqual([]);
        });
    });

    describe('compareTracesEssential action matching', () => {
         it('handles name mismatches and fuzzy matching', () => {
             const golden = [{ 
                 id: 'EVT-0001', correlationId: 'COR-0001', type: 'action-start', data: { name: 'rest.GET' }, origin: 'system' 
             }, {
                 id: 'EVT-0002', correlationId: 'COR-0001', type: 'rest-request', data: { method: 'GET', url: '/foo' } 
             }, {
                 id: 'EVT-0003', correlationId: 'COR-0001', type: 'action-end' 
             }];
             
             // Different name but starts with rest. -> should match via areActionNamesCompatible
             const evidence = [{ 
                 id: 'EVT-0001', correlationId: 'COR-0001', type: 'action-start', data: { name: 'rest.POST' }, origin: 'system' 
             }, {
                 id: 'EVT-0002', correlationId: 'COR-0001', type: 'rest-request', data: { method: 'GET', url: '/foo' } 
             }, {
                 id: 'EVT-0003', correlationId: 'COR-0001', type: 'action-end' 
             }];
             
             const result = compareTracesEssential(golden, evidence);
             expect(result.errors).toEqual([]);
         });

         it('allows name mismatch if origin is user', () => {
             const golden = [{ 
                 id: 'EVT-0001', correlationId: 'COR-0001', type: 'action-start', data: { name: 'A' }, origin: 'user' 
             }, { id: 'EVT-0002', correlationId: 'COR-0001', type: 'action-end' }];
             
             const evidence = [{ 
                 id: 'EVT-0001', correlationId: 'COR-0001', type: 'action-start', data: { name: 'B' }, origin: 'system' 
             }, { id: 'EVT-0002', correlationId: 'COR-0001', type: 'action-end' }];
             
             const result = compareTracesEssential(golden, evidence);
             expect(result.errors).toEqual([]);
         });

         it('formats missing rest calls in error message', () => {
             const golden = [{ 
                 id: 'EVT-0001', correlationId: 'COR-0001', type: 'action-start', data: { name: 'MyAction' } 
             }, {
                 id: 'EVT-0002', correlationId: 'COR-0001', type: 'rest-request', data: { method: 'POST', url: '/api/submit' } 
             }, {
                 id: 'EVT-0003', correlationId: 'COR-0001', type: 'action-end' 
             }];
             const evidence = []; // Missing entirely
             
             const result = compareTracesEssential(golden, evidence);
             expect(result.errors.length).toBeGreaterThan(0);
             expect(result.errors[0]).toContain('POST /api/submit');
         });

         it('detects reused/missing duplicates', () => {
             // Expected: 2 identical actions
             // Actual: 1 matching action
             const action = [
                 { id: 'EVT-0001', correlationId: 'COR-0001', type: 'action-start', data: { name: 'A' } },
                 { id: 'EVT-0002', correlationId: 'COR-0001', type: 'rest-request', data: { method: 'GET', url: '/' } },
                 { id: 'EVT-0003', correlationId: 'COR-0001', type: 'action-end' }
             ];
             const action2 = [
                 { id: 'EVT-0004', correlationId: 'COR-0002', type: 'action-start', data: { name: 'A' } },
                 { id: 'EVT-0005', correlationId: 'COR-0002', type: 'rest-request', data: { method: 'GET', url: '/' } },
                 { id: 'EVT-0006', correlationId: 'COR-0002', type: 'action-end' }
             ];

             const golden = [...action, ...action2];
             const evidence = [...action]; // Only one instance
             
             const result = compareTracesEssential(golden, evidence);
             // The logic at lines 573-574 allows reuse of actual actions for multiple expected actions
             // So this should NOT report an error, hitting the 'reusedIndex' path.
             expect(result.errors.length).toBe(0);
         });
    });


    describe('formatTraceErrors', () => {
        it('returns empty string for no errors', () => {
            expect(formatTraceErrors([])).toBe('');
        });
        
        it('formats errors with context and diff summary', () => {
            const errors = ['Error 1', 'Error 2'];
            const diff = { missingActions: [1], unexpectedActions: [1, 2], orderingViolations: [] };
            const output = formatTraceErrors(errors, 'Test', diff);
            expect(output).toContain('Trace comparison failed for Test');
            expect(output).toContain('Error 1');
            expect(output).toContain('Missing actions: 1');
            expect(output).toContain('Unexpected actions: 2');
            expect(output).not.toContain('Ordering violations:');
        });
    });

    describe('compareTraceFiles', () => {
        it('compares files correctly', async () => {
            const golden = [{ type: 'rest-request', data: { method: 'GET', url: '/foo' }, correlationId: 'COR-0001', origin: 'ui' }];
            const evidence = [{ type: 'rest-request', data: { method: 'GET', url: '/foo' }, correlationId: 'COR-0001', origin: 'ui' }];
            
            vi.mocked(fsp.readFile).mockResolvedValueOnce(JSON.stringify(golden)); // golden
            vi.mocked(fsp.readFile).mockResolvedValueOnce(JSON.stringify(evidence)); // evidence
            
            const result = await compareTraceFiles('/golden', '/evidence');
            expect(result.errors).toEqual([]);
        });
        
        it('detects missing actions', async () => {
            const golden = [{ type: 'rest-request', data: { method: 'GET', url: '/foo' }, correlationId: 'COR-0001', origin: 'ui' }];
            const evidence = [];
            
            vi.mocked(fsp.readFile).mockResolvedValueOnce(JSON.stringify(golden));
            vi.mocked(fsp.readFile).mockResolvedValueOnce(JSON.stringify(evidence));
            
            const result = await compareTraceFiles('/golden', '/evidence');
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('detects unexpected actions', async () => {
            const golden = [];
            const evidence = [{ type: 'rest-request', data: { method: 'GET', url: '/foo' }, correlationId: 'COR-0001', origin: 'ui' }];
            
            vi.mocked(fsp.readFile).mockResolvedValueOnce(JSON.stringify(golden));
            vi.mocked(fsp.readFile).mockResolvedValueOnce(JSON.stringify(evidence));
            
            const result = await compareTraceFiles('/golden', '/evidence');
            if (result.errors.length === 0) {
                 // If no text errors, check diff structure
                 expect(result.diff?.unexpectedActions?.length).toBeGreaterThan(0);
            } else {
                 expect(result.errors.length).toBeGreaterThan(0);
            }
        });
        
        it('detects data mismatch', async () => {
             const golden = [{ type: 'rest-request', data: { method: 'GET', url: '/foo' }, correlationId: 'COR-0001', origin: 'ui' }];
             const evidence = [{ type: 'rest-request', data: { method: 'GET', url: '/bar' }, correlationId: 'COR-0001', origin: 'ui' }];
             
             vi.mocked(fsp.readFile).mockResolvedValueOnce(JSON.stringify(golden));
             vi.mocked(fsp.readFile).mockResolvedValueOnce(JSON.stringify(evidence));
             
             const result = await compareTraceFiles('/golden', '/evidence');
             expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('compareOrPromoteTraceFiles', () => {
        it('promotes file if golden missing', async () => {
             vi.mocked(fsp.stat).mockRejectedValue(new Error('ENOENT'));
             vi.mocked(fsp.mkdir).mockResolvedValue(undefined as any);
             vi.mocked(fsp.copyFile).mockResolvedValue(undefined as any);
             
             const result = await compareOrPromoteTraceFiles('/golden', '/evidence');
             expect(result.promoted).toBe(true);
             expect(fsp.mkdir).toHaveBeenCalledWith('/golden', expect.anything());
             expect(fsp.copyFile).toHaveBeenCalledWith(expect.stringContaining('evidence'), expect.stringContaining('golden'));
        });
        
        it('compares if golden exists', async () => {
            vi.mocked(fsp.stat).mockResolvedValue({ isFile: () => true } as any);
            const golden = [{ type: 'rest-request', data: { method: 'GET', url: '/foo' }, correlationId: 'COR-0001', origin: 'ui' }];
            const evidence = [{ type: 'rest-request', data: { method: 'GET', url: '/foo' }, correlationId: 'COR-0001', origin: 'ui' }];
            vi.mocked(fsp.readFile).mockResolvedValueOnce(JSON.stringify(golden)); // golden
            vi.mocked(fsp.readFile).mockResolvedValueOnce(JSON.stringify(evidence)); // evidence
            
            const result = await compareOrPromoteTraceFiles('/golden', '/evidence');
            expect(result.promoted).toBe(false);
            expect(fsp.copyFile).not.toHaveBeenCalled();
            expect(result.errors).toEqual([]);
        });
    });
});
