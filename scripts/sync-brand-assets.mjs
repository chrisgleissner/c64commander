#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import yaml from 'js-yaml';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_VARIANTS_PATH = path.join(REPO_ROOT, 'variants/variants.yaml');
const DEFAULT_SOURCE_LOGO_PATH = path.join(REPO_ROOT, 'docs/img/c64commander.png');
const ICON_CANVAS_SIZE = 1024;
const ICON_LOGO_OCCUPANCY = 0.68;
const TRANSPARENT_BACKGROUND = { r: 0, g: 0, b: 0, alpha: 0 };

export class BrandAssetSyncError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BrandAssetSyncError';
    }
}

const fail = (message) => {
    throw new BrandAssetSyncError(message);
};

const requireMapping = (value, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${label} must be a YAML mapping`);
    }
};

const requireNonEmptyString = (value, label) => {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`${label} must be a non-empty string`);
    }
    return value.trim();
};

const ensureRepoRelativePath = (repoRoot, relativePath, label) => {
    const normalized = requireNonEmptyString(relativePath, label);
    const absolutePath = path.resolve(repoRoot, normalized);
    const relativeToRepoRoot = path.relative(repoRoot, absolutePath);
    if (
        relativeToRepoRoot === '..' ||
        relativeToRepoRoot.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeToRepoRoot)
    ) {
        fail(`${label} must stay within the repository: ${relativePath}`);
    }
    return absolutePath;
};

const parseBrandTargets = ({ repoRoot = REPO_ROOT, variantsPath = DEFAULT_VARIANTS_PATH } = {}) => {
    let raw;
    try {
        raw = yaml.load(fs.readFileSync(variantsPath, 'utf8'));
    } catch (error) {
        fail(`failed to parse variant configuration: ${error.message}`);
    }

    requireMapping(raw, 'variants root');
    requireMapping(raw.variants, 'variants');

    return Object.entries(raw.variants).map(([variantId, entry]) => {
        requireMapping(entry, `variants.${variantId}`);
        requireMapping(entry.assets, `variants.${variantId}.assets`);
        requireMapping(entry.assets.sources, `variants.${variantId}.assets.sources`);

        const resolveTarget = (key) => {
            requireMapping(entry.assets.sources[key], `variants.${variantId}.assets.sources.${key}`);
            const outputFormat = requireNonEmptyString(
                entry.assets.sources[key].format,
                `variants.${variantId}.assets.sources.${key}.format`,
            ).toLowerCase();
            if (outputFormat !== 'png') {
                fail(`variants.${variantId}.assets.sources.${key}.format must be png for brand sync outputs`);
            }
            return ensureRepoRelativePath(
                repoRoot,
                entry.assets.sources[key].path,
                `variants.${variantId}.assets.sources.${key}.path`,
            );
        };

        return {
            id: variantId,
            iconPath: resolveTarget('icon'),
            logoPath: resolveTarget('logo'),
            splashPath: resolveTarget('splash'),
        };
    });
};

const writeBinaryOutputFile = ({ outputPath, content, check }) => {
    let existing = null;
    try {
        existing = fs.readFileSync(outputPath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    if (check) {
        if (!existing || !existing.equals(content)) {
            fail(`generated file is out of date: ${path.relative(REPO_ROOT, outputPath)}\n  run: node scripts/sync-brand-assets.mjs`);
        }
        return false;
    }

    if (existing && existing.equals(content)) {
        return false;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content);
    return true;
};

const buildPaddedIcon = async (sourceLogoPath) => {
    const logoMaxSize = Math.round(ICON_CANVAS_SIZE * ICON_LOGO_OCCUPANCY);
    const centeredLogo = await sharp(sourceLogoPath)
        .resize({
            width: logoMaxSize,
            height: logoMaxSize,
            fit: 'inside',
        })
        .png()
        .toBuffer();

    return sharp({
        create: {
            width: ICON_CANVAS_SIZE,
            height: ICON_CANVAS_SIZE,
            channels: 4,
            background: TRANSPARENT_BACKGROUND,
        },
    })
        .composite([{ input: centeredLogo, gravity: 'center' }])
        .png()
        .toBuffer();
};

export const syncBrandAssets = async ({
    repoRoot = REPO_ROOT,
    variantsPath = DEFAULT_VARIANTS_PATH,
    sourceLogoPath = DEFAULT_SOURCE_LOGO_PATH,
    check = false,
} = {}) => {
    const absoluteLogoPath = path.isAbsolute(sourceLogoPath) ? sourceLogoPath : path.resolve(repoRoot, sourceLogoPath);
    if (!fs.existsSync(absoluteLogoPath)) {
        fail(`source logo is missing: ${path.relative(repoRoot, absoluteLogoPath)}`);
    }

    const targets = parseBrandTargets({ repoRoot, variantsPath });
    const logoBuffer = fs.readFileSync(absoluteLogoPath);
    const splashBuffer = logoBuffer;
    const iconBuffer = await buildPaddedIcon(absoluteLogoPath);

    const changed = targets
        .flatMap((target) => [
            writeBinaryOutputFile({ outputPath: target.logoPath, content: logoBuffer, check }),
            writeBinaryOutputFile({ outputPath: target.splashPath, content: splashBuffer, check }),
            writeBinaryOutputFile({ outputPath: target.iconPath, content: iconBuffer, check }),
        ])
        .some(Boolean);

    return {
        changed,
        sourceLogoPath: absoluteLogoPath,
        targets,
    };
};

const isDirectInvocation = () => {
    const entry = process.argv[1];
    if (!entry) return false;
    return path.resolve(entry) === fileURLToPath(import.meta.url);
};

const parseCliArgs = (args) => {
    let check = false;
    for (const arg of args) {
        if (arg === '--check') {
            check = true;
            continue;
        }
        fail(`unknown argument: ${arg}`);
    }
    return { check };
};

if (isDirectInvocation()) {
    const { check } = parseCliArgs(process.argv.slice(2));
    syncBrandAssets({ check })
        .then((result) => {
            const mode = check ? 'checked' : 'synced';
            process.stdout.write(`${mode} brand assets for ${result.targets.length} variant(s)\n`);
        })
        .catch((error) => {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        });
}