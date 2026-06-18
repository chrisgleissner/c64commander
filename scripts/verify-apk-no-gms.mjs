#!/usr/bin/env node
/*
 * Asserts that an APK has NO HARD dependency on Google Play Services / Google
 * Mobile Services, so it can install and run on a Google-less environment
 * (Sailfish OS Android AppSupport, AOSP emulator image, de-Googled device).
 *
 * A hard dependency is a REQUIRED `<uses-library>` or `<uses-feature>` naming a
 * Google component. Mere code references to GMS symbols are NOT a hard
 * dependency (the GMS client libraries are designed to degrade gracefully), so
 * this static check intentionally only flags required manifest declarations.
 * The authoritative complement is a runtime launch test on a non-GMS image
 * (see docs/research/callback8020/sailfish-callback-8020-emulation.md).
 *
 * Usage:
 *   node scripts/verify-apk-no-gms.mjs <apk> [--json]
 *
 * Tool discovery matches scripts/verify-apk-metadata.mjs (aapt2/aapt).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export class ApkGmsError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ApkGmsError';
    }
}

// Google component name fragments that, if declared as a REQUIRED uses-library
// or uses-feature, indicate a hard Google dependency.
const GOOGLE_LIBRARY_MARKERS = ['com.google.android.gms', 'com.google.android.maps', 'com.google.firebase'];
const GOOGLE_FEATURE_MARKERS = ['com.google.android.gms'];

const looksGoogle = (name, markers) => markers.some((marker) => name.includes(marker));

// Parse `aapt[2] dump badging` for hard Google dependencies.
export const analyzeGmsUsage = (badging) => {
    const requiredLibraries = [];
    const requiredFeatures = [];

    for (const line of badging.split('\n')) {
        const trimmed = line.trim();
        // `uses-library:'name'` is required; `uses-library-not-required:'name'` is optional.
        const libMatch = /^uses-library:'([^']+)'/.exec(trimmed);
        if (libMatch && looksGoogle(libMatch[1], GOOGLE_LIBRARY_MARKERS)) {
            requiredLibraries.push(libMatch[1]);
            continue;
        }
        // `uses-feature:'name'` (required) vs `uses-feature-not-required:'name'`.
        const featMatch = /^uses-feature:'([^']+)'/.exec(trimmed);
        if (featMatch && looksGoogle(featMatch[1], GOOGLE_FEATURE_MARKERS)) {
            requiredFeatures.push(featMatch[1]);
        }
    }

    return {
        requiredLibraries,
        requiredFeatures,
        ok: requiredLibraries.length === 0 && requiredFeatures.length === 0,
    };
};

const candidateTools = () => {
    const tools = [];
    if (process.env.AAPT2) tools.push(process.env.AAPT2);
    if (process.env.AAPT) tools.push(process.env.AAPT);
    for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean)) {
        const dir = path.join(root, 'build-tools');
        let versions = [];
        try {
            versions = fs.readdirSync(dir).sort().reverse();
        } catch {
            versions = [];
        }
        for (const v of versions) {
            tools.push(path.join(dir, v, 'aapt2'), path.join(dir, v, 'aapt'));
        }
    }
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
    throw new ApkGmsError(`unable to run aapt2/aapt dump badging on ${apkPath}.\n  tried:\n   - ${errors.join('\n   - ')}`);
};

export const verifyApkNoGms = (apkPath) => {
    if (!fs.existsSync(apkPath)) {
        throw new ApkGmsError(`APK not found: ${apkPath}`);
    }
    const result = analyzeGmsUsage(runBadging(apkPath));
    if (!result.ok) {
        throw new ApkGmsError(
            `APK declares a hard Google dependency: libraries=[${result.requiredLibraries.join(', ')}] features=[${result.requiredFeatures.join(', ')}]`,
        );
    }
    return result;
};

const isDirectInvocation = () => {
    const entry = process.argv[1];
    return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
};

if (isDirectInvocation()) {
    const args = process.argv.slice(2);
    const json = args.includes('--json');
    const apkPath = args.find((a) => !a.startsWith('--'));
    try {
        if (!apkPath) throw new ApkGmsError('usage: verify-apk-no-gms.mjs <apk> [--json]');
        const result = verifyApkNoGms(apkPath);
        if (json) {
            console.log(JSON.stringify({ apk: apkPath, ...result }, null, 2));
        } else {
            console.log(`APK ${path.basename(apkPath)} has no hard Google Play Services dependency.`);
        }
    } catch (error) {
        if (error instanceof ApkGmsError) {
            console.error(error.message);
            process.exit(1);
        }
        throw error;
    }
}
