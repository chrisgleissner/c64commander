import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('HVSC non-native safety guard', () => {
    it('requires explicit non-native override and guard assertion in ingestion runtime', () => {
        const runtime = readFileSync(path.resolve(process.cwd(), 'src/lib/hvsc/hvscIngestionRuntime.ts'), 'utf8');
        expect(runtime).toContain('VITE_ENABLE_NON_NATIVE_HVSC_INGESTION');
        expect(runtime).toContain('assertNonNativeHvscIngestionAllowed()');
        expect(runtime).toContain('requires the native ingestion plugin on this platform');
    });
});
