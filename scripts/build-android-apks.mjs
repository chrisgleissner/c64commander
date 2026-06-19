#!/usr/bin/env node
/*
 * Builds the Android debug APK for EVERY published variant in one run, so the
 * canonical "build the Android app" command produces both the C64 Commander APK
 * and the C64U Remote APK (and any future published variant).
 *
 * For each variant it:
 *   1. regenerates variant + feature-flag outputs for that variant (APP_VARIANT),
 *   2. builds the web bundle and syncs Capacitor for Android,
 *   3. runs `./gradlew assembleDebug`,
 *   4. locates the produced APK (named "<exported_file_basename>-<version>-debug.apk"),
 *   5. optionally verifies the APK metadata (label + application id).
 *
 * The build log clearly states which variant produced which APK. The script
 * fails loudly if the Android toolchain is unavailable — it never silently
 * builds only one APK.
 *
 * Usage:
 *   node scripts/build-android-apks.mjs [--target ci|release] [--variants a,b]
 *                                       [--verify-metadata]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseVariantSource, resolvePublishVariants } from './generate-variant.mjs';
import { verifyApkMetadata } from './verify-apk-metadata.mjs';
import { verifyApkNoGms } from './verify-apk-no-gms.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APK_DEBUG_DIR = path.join(REPO_ROOT, 'android/app/build/outputs/apk/debug');
// The Android Gradle Plugin cleans stale APKs from the shared per-build-type
// output directory, so when several variants are built sequentially only the
// last one survives there. We copy each variant's APK into a stable collection
// directory so BOTH (all) APKs persist after a single `android:apk:all` run.
const COLLECT_DIR = path.join(REPO_ROOT, 'artifacts/android-apks');

const parseArgs = (argv) => {
    const args = { target: 'ci', explicitVariants: null, verifyMetadata: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--target') {
            args.target = argv[(i += 1)];
        } else if (arg === '--variants') {
            args.explicitVariants = (argv[(i += 1)] ?? '')
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean);
        } else if (arg === '--verify-metadata') {
            args.verifyMetadata = true;
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }
    return args;
};

const run = (command, commandArgs, env) => {
    console.log(`\n$ ${command} ${commandArgs.join(' ')}`);
    execFileSync(command, commandArgs, {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        env: { ...process.env, ...env },
    });
};

const findApk = (basename) => {
    if (!fs.existsSync(APK_DEBUG_DIR)) return null;
    const matches = fs
        .readdirSync(APK_DEBUG_DIR)
        .filter((name) => name.startsWith(`${basename}-`) && name.endsWith('.apk'))
        .map((name) => path.join(APK_DEBUG_DIR, name));
    return matches[0] ?? null;
};

const main = () => {
    const args = parseArgs(process.argv.slice(2));
    const config = parseVariantSource(fs.readFileSync(path.join(REPO_ROOT, 'variants/variants.yaml'), 'utf8'), {
        repoRoot: REPO_ROOT,
    });
    const variantIds = resolvePublishVariants(config, {
        publishTarget: args.target,
        explicitVariants: args.explicitVariants,
    });

    console.log(`Building Android debug APKs for variant(s): ${variantIds.join(', ')}`);
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    const built = [];

    for (const variantId of variantIds) {
        const variant = config.variants[variantId];
        console.log(`\n========== Variant: ${variantId} (${variant.displayName}) ==========`);

        // Regenerate variant outputs + web bundle + Capacitor sync for THIS variant.
        run(npmCmd, ['run', 'cap:build'], { APP_VARIANT: variantId });
        // Build the debug APK.
        execFileSync(gradlew, ['assembleDebug', '--warning-mode', 'none'], {
            cwd: path.join(REPO_ROOT, 'android'),
            stdio: 'inherit',
            env: { ...process.env, APP_VARIANT: variantId },
        });

        const builtApkPath = findApk(variant.exportedFileBasename);
        if (!builtApkPath) {
            throw new Error(
                `expected an APK starting with "${variant.exportedFileBasename}-" in ${APK_DEBUG_DIR} for variant ${variantId}, but found none`,
            );
        }

        // Persist the APK into the stable collection dir so it survives the next
        // variant's Gradle run.
        fs.mkdirSync(COLLECT_DIR, { recursive: true });
        const apkPath = path.join(COLLECT_DIR, path.basename(builtApkPath));
        fs.copyFileSync(builtApkPath, apkPath);

        const sizeBytes = fs.statSync(apkPath).size;
        const record = {
            variant: variantId,
            displayName: variant.displayName,
            applicationId: variant.platform.android.applicationId,
            apkPath,
            sizeBytes,
        };
        if (args.verifyMetadata) {
            record.metadata = verifyApkMetadata(apkPath, {
                expectApplicationId: variant.platform.android.applicationId,
                expectLabel: variant.displayName,
            });
            record.gms = verifyApkNoGms(apkPath);
        }
        built.push(record);
        console.log(`-> ${variantId}: ${path.relative(REPO_ROOT, apkPath)} (${(sizeBytes / 1024 / 1024).toFixed(2)} MiB)`);
    }

    console.log('\n=== Android APK build summary ===');
    for (const record of built) {
        console.log(
            `${record.variant.padEnd(14)} | ${record.applicationId.padEnd(28)} | ${path.relative(REPO_ROOT, record.apkPath)}` +
                (record.metadata ? ` | label="${record.metadata.label}"` : ''),
        );
    }
    console.log(`\n${built.length} APK(s) collected in ${path.relative(REPO_ROOT, COLLECT_DIR)}/`);
};

try {
    main();
} catch (error) {
    console.error(`\nbuild-android-apks failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
