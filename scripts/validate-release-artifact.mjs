import { execFileSync } from 'node:child_process';
import path from 'node:path';

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

const listZipEntries = (artifactPath) => {
    const stdout = execFileSync('unzip', ['-Z1', artifactPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
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

export const validateArtifactFile = (artifactPath, explicitPlatform = null) => {
    const platform = explicitPlatform ?? detectPlatform(artifactPath);
    const entries = listZipEntries(artifactPath);
    return validateArtifactEntries(platform, entries, artifactPath);
};

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
    return [
        `artifact: ${summary.artifactPath}`,
        `platform: ${summary.platform}`,
        `fileCount: ${summary.fileCount}`,
        `topLevelDirs: ${summary.topLevelDirs.join(', ')}`,
        `checks: ${passedChecks}`,
    ].join('\n');
};

const isDirectExecution = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectExecution) {
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
