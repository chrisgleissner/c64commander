import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ANDROID_MIN_ARM64_PAGE_ALIGNMENT = 0x4000;

export class ReleaseArtifactValidationError extends Error {
    constructor(message, summary) {
        super(message);
        this.name = 'ReleaseArtifactValidationError';
        this.summary = summary;
    }
}

const PLATFORM_REQUIREMENTS = {
    android: [
        {
            id: 'android-public-dir',
            description: 'bundled web payload directory',
            pattern: /^assets\/public\//,
        },
        {
            id: 'android-public-index',
            description: 'bundled web entrypoint',
            pattern: /^assets\/public\/index\.html$/,
        },
        {
            id: 'android-public-manifest',
            description: 'bundled web manifest',
            pattern: /^assets\/public\/manifest\.webmanifest$/,
        },
        {
            id: 'android-hvsc-wasm',
            description: 'bundled 7-Zip wasm runtime',
            pattern: /^assets\/public\/assets\/7zz-.*\.wasm$/,
        },
        {
            id: 'android-hvsc-bridge',
            description: 'bundled HVSC bridge chunk',
            pattern: /^assets\/public\/assets\/vendor-hvsc-.*\.js$/,
        },
        {
            id: 'android-lib7zz-arm64',
            description: 'bundled arm64 upstream 7-Zip runtime',
            pattern: /^lib\/arm64-v8a\/lib7zz\.so$/,
        },
        {
            id: 'android-lib7zz-armv7',
            description: 'bundled armv7 upstream 7-Zip runtime',
            pattern: /^lib\/armeabi-v7a\/lib7zz\.so$/,
        },
        {
            id: 'android-major-dirs',
            description: 'major APK payload directories',
            pattern: /^(META-INF|assets|lib|res)\//,
        },
    ],
    ios: [
        {
            id: 'ios-payload-app',
            description: 'app bundle payload',
            pattern: /^Payload\/[^/]+\.app\//,
        },
        {
            id: 'ios-public-index',
            description: 'bundled web entrypoint',
            pattern: /^Payload\/[^/]+\.app\/public\/index\.html$/,
        },
        {
            id: 'ios-public-manifest',
            description: 'bundled web manifest',
            pattern: /^Payload\/[^/]+\.app\/public\/manifest\.webmanifest$/,
        },
        {
            id: 'ios-hvsc-wasm',
            description: 'bundled 7-Zip wasm runtime',
            pattern: /^Payload\/[^/]+\.app\/public\/assets\/7zz-.*\.wasm$/,
        },
        {
            id: 'ios-hvsc-bridge',
            description: 'bundled HVSC bridge chunk',
            pattern: /^Payload\/[^/]+\.app\/public\/assets\/vendor-hvsc-.*\.js$/,
        },
        {
            id: 'ios-swcompression',
            description: 'bundled native SWCompression framework',
            pattern: /^Payload\/[^/]+\.app\/Frameworks\/SWCompression\.framework\/SWCompression$/,
        },
        {
            id: 'ios-capacitor-native-bridge',
            description: 'bundled Capacitor native bridge',
            pattern: /^Payload\/[^/]+\.app\/Frameworks\/Capacitor\.framework\/native-bridge\.js$/,
        },
        {
            id: 'ios-assets-car',
            description: 'compiled iOS asset catalog',
            pattern: /^Payload\/[^/]+\.app\/Assets\.car$/,
        },
    ],
};

const detectPlatform = (artifactPath) => {
    const extension = path.extname(artifactPath).toLowerCase();
    if (extension === '.apk') {
        return 'android';
    }
    if (extension === '.ipa') {
        return 'ios';
    }
    throw new Error(`Unable to infer platform from artifact path: ${artifactPath}`);
};

export const ensureCommandAvailable = (command, probe = spawnSync) => {
    const result = probe(command, ['-v'], {
        encoding: 'utf8',
        stdio: 'ignore',
    });

    if (result.error) {
        throw new Error(
            result.error.code === 'ENOENT'
                ? `Required binary "${command}" is not available on PATH; install it before validating release artifacts.`
                : `Failed to probe required binary "${command}": ${result.error.message}`,
        );
    }
};

export const listZipEntries = (artifactPath, { execFile = execFileSync, ensureCommand = ensureCommandAvailable } = {}) => {
    ensureCommand('unzip');
    const stdout = execFile('unzip', ['-Z1', artifactPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
};

export const parseElfLoadAlignments = (readelfOutput) =>
    readelfOutput
        .split(/\r?\n/)
        .map((line) => line.match(/\bLOAD\b.*\s(0x[0-9a-fA-F]+)\s*$/))
        .filter(Boolean)
        .map((match) => Number.parseInt(match[1], 16));

export const validateAndroidNativeAlignmentReports = (
    reports,
    minimumAlignment = ANDROID_MIN_ARM64_PAGE_ALIGNMENT,
) => {
    const checks = reports.map((report) => {
        const smallestAlignment = report.alignments.length > 0 ? Math.min(...report.alignments) : 0;
        return {
            ...report,
            minimumAlignment,
            smallestAlignment,
            ok: report.alignments.length > 0 && smallestAlignment >= minimumAlignment,
        };
    });

    return {
        minimumAlignment,
        checks,
        failures: checks
            .filter((check) => !check.ok)
            .map((check) => ({
                entry: check.entry,
                smallestAlignment: check.smallestAlignment,
                minimumAlignment: check.minimumAlignment,
            })),
    };
};

const summarizeTopLevelDirs = (entries) =>
    Array.from(
        new Set(
            entries.map((entry) => {
                const [topLevel] = entry.split('/');
                return topLevel;
            }),
        ),
    ).sort();

export const validateArtifactEntries = (platform, entries, artifactPath = null) => {
    const requirements = PLATFORM_REQUIREMENTS[platform];
    if (!requirements) {
        throw new Error(`Unsupported platform: ${platform}`);
    }

    const checks = requirements.map((requirement) => {
        const matches = entries.filter((entry) => requirement.pattern.test(entry));
        return {
            ...requirement,
            ok: matches.length > 0,
            matches: matches.slice(0, 5),
            matchCount: matches.length,
        };
    });

    const summary = {
        artifactPath,
        platform,
        fileCount: entries.length,
        topLevelDirs: summarizeTopLevelDirs(entries),
        checks,
        missing: checks.filter((check) => !check.ok).map((check) => ({ id: check.id, description: check.description })),
    };

    if (summary.missing.length > 0) {
        const details = summary.missing.map((item) => `${item.id} (${item.description})`).join(', ');
        throw new ReleaseArtifactValidationError(`Missing required ${platform} artifact payload: ${details}`, summary);
    }

    return summary;
};

export const inspectAndroidArtifactNativeAlignment = (
    artifactPath,
    entries,
    {
        execFile = execFileSync,
        ensureCommand = ensureCommandAvailable,
        minimumAlignment = ANDROID_MIN_ARM64_PAGE_ALIGNMENT,
    } = {},
) => {
    const arm64NativeEntries = entries.filter((entry) => /^lib\/arm64-v8a\/.*\.so$/.test(entry));
    if (arm64NativeEntries.length === 0) {
        return {
            minimumAlignment,
            checks: [],
            failures: [],
        };
    }

    ensureCommand('unzip');
    ensureCommand('readelf');

    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'android-artifact-native-'));
    try {
        const reports = arm64NativeEntries.map((entry) => {
            const binary = execFile('unzip', ['-p', artifactPath, entry], {
                encoding: null,
                stdio: ['ignore', 'pipe', 'pipe'],
                maxBuffer: 16 * 1024 * 1024,
            });
            const tempFile = path.join(tempDir, path.basename(entry));
            writeFileSync(tempFile, binary);
            const readelfOutput = execFile('readelf', ['-lW', tempFile], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            return {
                entry,
                alignments: parseElfLoadAlignments(readelfOutput),
            };
        });

        return validateAndroidNativeAlignmentReports(reports, minimumAlignment);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
};

export const validateArtifactFile = (artifactPath, explicitPlatform = null) => {
    const platform = explicitPlatform ?? detectPlatform(artifactPath);
    const entries = listZipEntries(artifactPath);
    const summary = validateArtifactEntries(platform, entries, artifactPath);

    if (platform !== 'android') {
        return summary;
    }

    const nativeAlignment = inspectAndroidArtifactNativeAlignment(artifactPath, entries);
    const result = {
        ...summary,
        nativeAlignment,
    };

    if (nativeAlignment.failures.length > 0) {
        const details = nativeAlignment.failures
            .map(
                (failure) =>
                    `${failure.entry} (smallest LOAD alignment 0x${failure.smallestAlignment.toString(16)}, expected >= 0x${failure.minimumAlignment.toString(16)})`,
            )
            .join(', ');
        throw new ReleaseArtifactValidationError(
            `Android native libraries are not 16 KB page-size compatible: ${details}`,
            result,
        );
    }

    return result;
};

export const isDirectExecution = (argvPath, moduleUrl) => Boolean(argvPath) && moduleUrl === pathToFileURL(argvPath).href;

const parseArgs = (argv) => {
    const options = {
        artifactPath: null,
        platform: null,
        json: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--json') {
            options.json = true;
            continue;
        }
        if (arg === '--platform') {
            options.platform = argv[index + 1] ?? null;
            index += 1;
            continue;
        }
        if (arg.startsWith('--platform=')) {
            options.platform = arg.slice('--platform='.length);
            continue;
        }
        if (!options.artifactPath) {
            options.artifactPath = arg;
            continue;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }

    if (!options.artifactPath) {
        throw new Error('Usage: node scripts/validate-release-artifact.mjs <artifact-path> [--platform android|ios] [--json]');
    }

    return options;
};

const formatSummary = (summary) => {
    const passedChecks = summary.checks.filter((check) => check.ok).map((check) => check.id).join(', ');
    const lines = [
        `artifact: ${summary.artifactPath}`,
        `platform: ${summary.platform}`,
        `fileCount: ${summary.fileCount}`,
        `topLevelDirs: ${summary.topLevelDirs.join(', ')}`,
        `checks: ${passedChecks}`,
    ];

    if (summary.nativeAlignment) {
        const nativeChecks = summary.nativeAlignment.checks
            .map(
                (check) =>
                    `${check.entry}=0x${check.smallestAlignment.toString(16)}${check.ok ? '' : ' (FAIL)'}`,
            )
            .join(', ');
        lines.push(`nativeAlignment: ${nativeChecks || 'n/a'}`);
    }

    return lines.join('\n');
};

const directExecution = isDirectExecution(process.argv[1], import.meta.url);

if (directExecution) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const summary = validateArtifactFile(options.artifactPath, options.platform);
        if (options.json) {
            console.log(JSON.stringify(summary, null, 2));
        } else {
            console.log(formatSummary(summary));
        }
    } catch (error) {
        if (error instanceof ReleaseArtifactValidationError) {
            console.error(error.message);
            console.error(JSON.stringify(error.summary, null, 2));
            process.exitCode = 1;
        } else {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    }
}
