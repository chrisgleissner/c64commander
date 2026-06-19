#!/usr/bin/env node
/*
 * Verifies the identity metadata baked into a built Android APK so that each
 * variant's APK is provably correct and distinguishable.
 *
 * It runs `aapt2 dump badging` (or `aapt dump badging`) on the APK and asserts:
 *   - the application id (package name) matches the expected value
 *   - the user-visible application label matches the expected value
 *
 * Usage:
 *   node scripts/verify-apk-metadata.mjs <apk> \
 *     --expect-application-id uk.gleissner.c64uremote \
 *     --expect-label "C64U Remote" [--json]
 *
 * Tool discovery order: $AAPT2 / $AAPT env vars, then the highest build-tools
 * version under $ANDROID_HOME / $ANDROID_SDK_ROOT, then `aapt2`/`aapt` on PATH.
 * If no tool is found the script exits non-zero (it never silently passes).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export class ApkMetadataError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ApkMetadataError';
    }
}

// Parse the relevant fields out of `aapt[2] dump badging` output.
export const parseBadging = (text) => {
    const packageMatch = /^package: name='([^']+)'/m.exec(text);
    const versionCodeMatch = /versionCode='([^']*)'/.exec(text);
    const versionNameMatch = /versionName='([^']*)'/.exec(text);

    // Label precedence: the default localized label, then the generic
    // application/launchable-activity label lines.
    const labelMatch =
        /^application-label:'([^']*)'/m.exec(text) ||
        /^application:\s*label='([^']*)'/m.exec(text) ||
        /^launchable-activity:[^\n]*\blabel='([^']*)'/m.exec(text);

    return {
        applicationId: packageMatch ? packageMatch[1] : null,
        label: labelMatch ? labelMatch[1] : null,
        versionCode: versionCodeMatch ? versionCodeMatch[1] : null,
        versionName: versionNameMatch ? versionNameMatch[1] : null,
    };
};

const candidateTools = () => {
    const tools = [];
    if (process.env.AAPT2) tools.push(process.env.AAPT2);
    if (process.env.AAPT) tools.push(process.env.AAPT);

    const sdkRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
    for (const root of sdkRoots) {
        const buildToolsDir = path.join(root, 'build-tools');
        let versions = [];
        try {
            versions = fs
                .readdirSync(buildToolsDir)
                .filter((entry) => fs.statSync(path.join(buildToolsDir, entry)).isDirectory())
                .sort()
                .reverse();
        } catch {
            versions = [];
        }
        for (const version of versions) {
            tools.push(path.join(buildToolsDir, version, 'aapt2'));
            tools.push(path.join(buildToolsDir, version, 'aapt'));
        }
    }

    // Fall back to whatever is on PATH.
    tools.push('aapt2', 'aapt');
    return tools;
};

const runBadging = (apkPath) => {
    const errors = [];
    for (const tool of candidateTools()) {
        try {
            return execFileSync(tool, ['dump', 'badging', apkPath], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                maxBuffer: 32 * 1024 * 1024,
            });
        } catch (error) {
            errors.push(`${tool}: ${error.code === 'ENOENT' ? 'not found' : error.message}`);
        }
    }
    throw new ApkMetadataError(
        `unable to run aapt2/aapt dump badging on ${apkPath}. Install Android build-tools or set $AAPT2.\n  tried:\n   - ${errors.join('\n   - ')}`,
    );
};

export const verifyApkMetadata = (apkPath, { expectApplicationId, expectLabel } = {}) => {
    if (!fs.existsSync(apkPath)) {
        throw new ApkMetadataError(`APK not found: ${apkPath}`);
    }
    const badging = runBadging(apkPath);
    const metadata = parseBadging(badging);

    const problems = [];
    if (!metadata.applicationId) {
        problems.push('could not read application id (package name) from APK');
    }
    if (expectApplicationId && metadata.applicationId !== expectApplicationId) {
        problems.push(`application id mismatch: expected "${expectApplicationId}", got "${metadata.applicationId}"`);
    }
    if (expectLabel && metadata.label !== expectLabel) {
        problems.push(`application label mismatch: expected "${expectLabel}", got "${metadata.label}"`);
    }
    if (problems.length > 0) {
        throw new ApkMetadataError(`APK metadata check failed for ${apkPath}:\n  - ${problems.join('\n  - ')}`);
    }
    return metadata;
};

const parseArgs = (argv) => {
    const args = { apkPath: null, expectApplicationId: undefined, expectLabel: undefined, json: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--expect-application-id') {
            args.expectApplicationId = argv[(i += 1)];
        } else if (arg === '--expect-label') {
            args.expectLabel = argv[(i += 1)];
        } else if (arg === '--json') {
            args.json = true;
        } else if (!args.apkPath) {
            args.apkPath = arg;
        } else {
            throw new ApkMetadataError(`unexpected argument: ${arg}`);
        }
    }
    if (!args.apkPath) {
        throw new ApkMetadataError('usage: verify-apk-metadata.mjs <apk> [--expect-application-id id] [--expect-label label] [--json]');
    }
    return args;
};

const isDirectInvocation = () => {
    const entry = process.argv[1];
    return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
};

if (isDirectInvocation()) {
    try {
        const args = parseArgs(process.argv.slice(2));
        const metadata = verifyApkMetadata(args.apkPath, {
            expectApplicationId: args.expectApplicationId,
            expectLabel: args.expectLabel,
        });
        if (args.json) {
            console.log(JSON.stringify({ apk: args.apkPath, ...metadata }, null, 2));
        } else {
            console.log(
                `APK ${path.basename(args.apkPath)} OK — applicationId=${metadata.applicationId} label="${metadata.label}" versionName=${metadata.versionName} versionCode=${metadata.versionCode}`,
            );
        }
    } catch (error) {
        if (error instanceof ApkMetadataError) {
            console.error(error.message);
            process.exit(1);
        }
        throw error;
    }
}
