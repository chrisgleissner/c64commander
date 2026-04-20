import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = {
    devDependencies?: Record<string, string>;
};

const packageJsonPath = path.resolve(process.cwd(), 'package.json');

const readPackageJson = (): PackageJson =>
    JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson;

const parseMajor = (versionRange: string): number => {
    const match = versionRange.match(/\d+/);
    if (!match) {
        throw new Error(`Unable to parse major version from ${versionRange}`);
    }
    return Number(match[0]);
};

describe('package dependency compatibility', () => {
    it('keeps @eslint/js aligned with eslint major', () => {
        const packageJson = readPackageJson();
        const eslintVersion = packageJson.devDependencies?.eslint;
        const eslintJsVersion = packageJson.devDependencies?.['@eslint/js'];

        expect(eslintVersion).toBeTruthy();
        expect(eslintJsVersion).toBeTruthy();
        expect(parseMajor(eslintJsVersion!)).toBe(parseMajor(eslintVersion!));
    });
});
