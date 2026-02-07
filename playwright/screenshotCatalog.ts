import { promises as fs } from 'node:fs';
import path from 'node:path';

type ScreenshotCatalog = Record<string, string[]>;

const CATALOG_PATH = path.resolve('playwright', 'screenshot-catalog.json');

const loadCatalog = async (): Promise<ScreenshotCatalog> => {
    try {
        const raw = await fs.readFile(CATALOG_PATH, 'utf8');
        const parsed = JSON.parse(raw) as ScreenshotCatalog;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.warn('Failed to load screenshot catalog.', error);
        return {};
    }
};

const saveCatalog = async (catalog: ScreenshotCatalog) => {
    const payload = JSON.stringify(catalog, null, 2);
    await fs.writeFile(CATALOG_PATH, `${payload}\n`, 'utf8');
};

export const sanitizeSegment = (value: string) => {
    const cleaned = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return cleaned || 'untitled';
};

export const registerScreenshotSections = async (pageId: string, slugs: string[]) => {
    const catalog = await loadCatalog();
    const existing = catalog[pageId] ?? [];
    let changed = false;
    slugs.forEach((slug) => {
        if (!existing.includes(slug)) {
            existing.push(slug);
            changed = true;
        }
    });
    if (changed) {
        catalog[pageId] = existing;
        await saveCatalog(catalog);
    }
    const orderMap = new Map<string, number>();
    existing.forEach((slug, index) => {
        orderMap.set(slug, index + 1);
    });
    return orderMap;
};
