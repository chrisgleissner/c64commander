import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readWorkflow = (name: string) => {
    return readFileSync(path.resolve(process.cwd(), '.github/workflows', name), 'utf8');
};

describe('Android release workflow contracts', () => {
    it('publishes signed APK and AAB artifacts for all tag builds, including RC tags', () => {
        const workflow = readWorkflow('android.yaml');

        expect(workflow).toContain('- name: Build APK (release)');
        expect(workflow).toContain("if: startsWith(github.ref, 'refs/tags/') && env.HAS_KEYSTORE == 'true'");
        expect(workflow).toContain('- name: Build App Bundle (release)');
        expect(workflow).toContain('- name: Upload APK artifact (release)');
        expect(workflow).toContain('- name: Upload AAB artifact (release)');
        expect(workflow).toContain('- name: Upload release artifacts to GitHub release');
    });

    it('uses a static release-artifact job name so skipped jobs do not leak raw matrix syntax', () => {
        const workflow = readWorkflow('android.yaml');

        expect(workflow).toContain('name: Release | Attach Android artifacts');
        expect(workflow).not.toContain('name: Release | Attach APK/AAB (${{ matrix.variant }})');
    });

    it('keeps Google Play upload restricted to non-RC tags', () => {
        const workflow = readWorkflow('android.yaml');

        expect(workflow).toContain('- name: Upload AAB to Google Play (internal)');
        expect(workflow).toContain(
            "if: startsWith(github.ref, 'refs/tags/') && !contains(github.ref_name, '-rc') && env.HAS_KEYSTORE == 'true'",
        );
    });
});
