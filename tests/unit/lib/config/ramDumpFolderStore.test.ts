/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
    deriveRamDumpFolderDisplayPath, 
    loadRamDumpFolderConfig, 
    saveRamDumpFolderConfig, 
    clearRamDumpFolderConfig,
    type RamDumpFolderConfig
} from '@/lib/config/ramDumpFolderStore';

// Mock addErrorLog
vi.mock('@/lib/logging', () => ({
    addErrorLog: vi.fn(),
}));

describe('ramDumpFolderStore', () => {
    describe('deriveRamDumpFolderDisplayPath', () => {
        it('returns fallback if treeUri is empty', () => {
            expect(deriveRamDumpFolderDisplayPath('', 'fallback')).toBe('fallback');
            expect(deriveRamDumpFolderDisplayPath('   ', 'fallback')).toBe('fallback');
            expect(deriveRamDumpFolderDisplayPath(null as any, 'fallback')).toBe('fallback');
        });

        it('handles primary volume paths', () => {
            expect(deriveRamDumpFolderDisplayPath('tree/primary:foo/bar')).toBe('Internal storage/foo/bar');
            expect(deriveRamDumpFolderDisplayPath('tree/primary:foo\\bar')).toBe('Internal storage/foo/bar');
        });

        it('handles other volume IDs', () => {
            expect(deriveRamDumpFolderDisplayPath('tree/ABCD-1234:stuff')).toBe('ABCD-1234/stuff');
        });

        it('normalizes slashes', () => {
            expect(deriveRamDumpFolderDisplayPath('tree/primary:a//b')).toBe('Internal storage/a/b');
        });

        it('decodes URI components', () => {
            expect(deriveRamDumpFolderDisplayPath('tree/primary:My%20Folder')).toBe('Internal storage/My Folder');
        });

        it('handles malformed URIs', () => {
            // "primary%" causes decodeURIComponent to throw
            expect(deriveRamDumpFolderDisplayPath('primary%')).toBe(null); 
            // wait, deriveRamDumpFolderDisplayPath calls match on result of decode
            // if decode fails, it catches and logs, but continues with raw trimmed?
            // "decoded = trimmed" if catch.
            // "primary%" match('tree/...') -> null.
            // returns fallback.
            
            expect(deriveRamDumpFolderDisplayPath('tree/primary%', 'fallback')).toBe('primary%/fallback');
        });
    });

    describe('loadRamDumpFolderConfig', () => {
        beforeEach(() => {
            vi.stubGlobal('localStorage', {
                getItem: vi.fn(),
                setItem: vi.fn(),
                removeItem: vi.fn(),
            });
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('returns null if no config', () => {
            vi.mocked(localStorage.getItem).mockReturnValue(null);
            expect(loadRamDumpFolderConfig()).toBeNull();
        });

        it('returns null if config is valid JSON but invalid structure', () => {
            vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ bad: 'data' }));
            expect(loadRamDumpFolderConfig()).toBeNull();
        });

        it('returns config if valid', () => {
            const valid = {
                treeUri: 'tree/primary:foo',
                rootName: 'foo',
                selectedAt: '2023-01-01',
            };
            vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(valid));
            
            const result = loadRamDumpFolderConfig();
            expect(result).toMatchObject(valid);
            expect(result?.displayPath).toBe('Internal storage/foo');
        });
        
        it('uses stored displayPath if present', () => {
             const valid = {
                treeUri: 'tree/primary:foo',
                rootName: 'foo',
                selectedAt: '2023-01-01',
                displayPath: 'Custom Path'
            };
            vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(valid));
            const result = loadRamDumpFolderConfig();
            expect(result?.displayPath).toBe('Custom Path');
        });

        it('handles JSON parse error', () => {
            vi.mocked(localStorage.getItem).mockReturnValue('{ invalid json');
             expect(loadRamDumpFolderConfig()).toBeNull();
        });
    });

    describe('saveRamDumpFolderConfig', () => {
        it('saves to localStorage and dispatches event', () => {
             vi.stubGlobal('localStorage', { setItem: vi.fn() });
             vi.stubGlobal('window', { 
                 dispatchEvent: vi.fn(), 
                 CustomEvent: class { constructor(public type: string, public detail: any) {} } 
             });

             const config: RamDumpFolderConfig = {
                 treeUri: 'u', rootName: 'r', selectedAt: 's', displayPath: 'd'
             };
             
             saveRamDumpFolderConfig(config);
             
             expect(localStorage.setItem).toHaveBeenCalledWith('c64u_ram_dump_folder:v1', JSON.stringify(config));
             expect(window.dispatchEvent).toHaveBeenCalled();
             
             vi.unstubAllGlobals();
        });
    });
    
    describe('clearRamDumpFolderConfig', () => {
        it('removes from localStorage and dispatches event', () => {
             vi.stubGlobal('localStorage', { removeItem: vi.fn() });
             vi.stubGlobal('window', { 
                 dispatchEvent: vi.fn(), 
                 CustomEvent: class { constructor(public type: string, public detail: any) {} } 
             });
             
             clearRamDumpFolderConfig();
             
             expect(localStorage.removeItem).toHaveBeenCalledWith('c64u_ram_dump_folder:v1');
             expect(window.dispatchEvent).toHaveBeenCalled();
             
             vi.unstubAllGlobals();
        });
    });
});
