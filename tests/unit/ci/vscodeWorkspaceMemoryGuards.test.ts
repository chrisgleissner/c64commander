import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type WorkspaceSettings = {
    'files.exclude'?: Record<string, boolean>;
    'search.exclude'?: Record<string, boolean>;
    'files.watcherExclude'?: Record<string, boolean>;
};

const workspaceSettingsPath = path.resolve(process.cwd(), '.vscode/settings.json');

const readWorkspaceSettings = (): WorkspaceSettings =>
    JSON.parse(readFileSync(workspaceSettingsPath, 'utf8')) as WorkspaceSettings;

describe('VS Code workspace memory guards', () => {
    it('excludes generated and sibling-project trees that can exhaust Copilot worker heap', () => {
        const settings = readWorkspaceSettings();

        expect(settings['files.exclude']).toMatchObject({
            '.tmp': true,
            'artifacts': true,
            'ci-artifacts': true,
            'coverage': true,
            'playwright-report': true,
            'playwright-report-coverage': true,
            'test-results': true,
            'android/app/build': true,
            'android/build': true,
            'c64scope/artifacts': true,
            '1541ultimate': true,
            'android-mcp-server': true,
            'c64bridge': true,
            'c64stream': true,
            'droidmind': true,
            'mobile-mcp': true,
            'test-data': true,
            'vivipi': true,
        });

        expect(settings['search.exclude']).toMatchObject({
            '**/.tmp/**': true,
            '**/artifacts/**': true,
            '**/ci-artifacts/**': true,
            '**/coverage/**': true,
            '**/playwright-report/**': true,
            '**/playwright-report-coverage/**': true,
            '**/test-results/**': true,
            '**/android/**/build/**': true,
            '**/c64scope/**/artifacts/**': true,
            '**/c64scope/**/dist/**': true,
            '1541ultimate/**': true,
            'android-mcp-server/**': true,
            'c64bridge/**': true,
            'c64stream/**': true,
            'droidmind/**': true,
            'mobile-mcp/**': true,
            'test-data/**': true,
            'vivipi/**': true,
        });

        expect(settings['files.watcherExclude']).toMatchObject({
            '**/.tmp/**': true,
            '**/artifacts/**': true,
            '**/ci-artifacts/**': true,
            '**/coverage/**': true,
            '**/playwright-report/**': true,
            '**/playwright-report-coverage/**': true,
            '**/test-results/**': true,
            '**/android/**/build/**': true,
            '**/c64scope/**/artifacts/**': true,
            '**/c64scope/**/dist/**': true,
            '1541ultimate/**': true,
            'android-mcp-server/**': true,
            'c64bridge/**': true,
            'c64stream/**': true,
            'droidmind/**': true,
            'mobile-mcp/**': true,
            'test-data/**': true,
            'vivipi/**': true,
        });
    });
});
