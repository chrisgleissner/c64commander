import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';
import { normalizeOptionToken } from './uiLogic';

export const buildConfigKey = (category: string, itemName: string) => `${category}::${itemName}`;

export const readItemValue = (payload: unknown, categoryName: string, itemName: string) => {
    const record = payload as Record<string, unknown> | undefined;
    const categoryBlock = (record?.[categoryName] ?? record) as Record<string, unknown> | undefined;
    const items = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
    if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return undefined;
    return normalizeConfigItem(items[itemName]).value;
};

export const readItemOptions = (payload: unknown, categoryName: string, itemName: string) => {
    const record = payload as Record<string, unknown> | undefined;
    const categoryBlock = (record?.[categoryName] ?? record) as Record<string, unknown> | undefined;
    const items = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
    if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return [];
    return normalizeConfigItem(items[itemName]).options ?? [];
};

export const readItemDetails = (payload: unknown, categoryName: string, itemName: string) => {
    const record = payload as Record<string, unknown> | undefined;
    const categoryBlock = (record?.[categoryName] ?? record) as Record<string, unknown> | undefined;
    const items = (categoryBlock?.items ?? categoryBlock) as Record<string, unknown> | undefined;
    if (!items || !Object.prototype.hasOwnProperty.call(items, itemName)) return undefined;
    return normalizeConfigItem(items[itemName]).details;
};

export const resolveConfigValue = (
    payload: unknown,
    category: string,
    itemName: string,
    fallback: string | number,
    configOverrides: Record<string, string | number | boolean>
) => {
    const override = configOverrides[buildConfigKey(category, itemName)];
    if (override !== undefined) return override;
    const value = readItemValue(payload, category, itemName);
    return value === undefined ? fallback : value;
};

export const parseNumericValue = (value: string | number, fallback: number) => {
    const match = String(value).trim().match(/[+-]?\d+(?:\.\d+)?/);
    if (!match) return fallback;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const resolveTurboControlValue = (cpuSpeed: string, options: string[]) => {
    const speed = parseNumericValue(cpuSpeed, 1);
    const desired = speed <= 1 ? 'Off' : 'Manual';
    const match = options.find((option) => normalizeOptionToken(option) === normalizeOptionToken(desired));
    return match ?? options[0] ?? desired;
};

export const formatPrinterLabel = (itemName: string) => {
    if (itemName === 'Page top margin (default is 5)') return 'Margin';
    if (itemName === 'Page height (default is 60)') return 'Height';
    if (itemName === 'Output file') return 'Output';
    if (itemName === 'Output type') return 'Type';
    if (itemName === 'Ink density') return 'Ink';
    if (itemName === 'Commodore charset') return 'CBM charset';
    if (itemName === 'Epson charset') return 'Epson set';
    if (itemName === 'IBM table 2') return 'IBM set';
    return itemName;
};

export const formatPrinterOptionLabel = (value: string) => {
    const normalized = value.trim();
    if (normalized === 'PNG B&W') return 'PNG B/W';
    if (normalized === 'PNG COLOR') return 'PNG Color';
    if (normalized === 'IBM Graphics Printer') return 'IBM Graphics';
    if (normalized === 'Commodore MPS') return 'MPS';
    if (normalized === 'Epson FX-80/JX-80') return 'Epson FX';
    if (normalized === 'IBM Proprinter') return 'IBM Pro';
    if (normalized === 'USA/UK') return 'US/UK';
    if (normalized === 'France/Italy') return 'FR/IT';
    if (normalized === 'Germany') return 'DE';
    if (normalized === 'Denmark') return 'DK';
    if (normalized === 'Denmark I') return 'DK I';
    if (normalized === 'Denmark II') return 'DK II';
    if (normalized === 'Spain') return 'ES';
    if (normalized === 'Sweden') return 'SE';
    if (normalized === 'Switzerland') return 'CH';
    if (normalized === 'France') return 'FR';
    if (normalized === 'Italy') return 'IT';
    if (normalized === 'Norway') return 'NO';
    if (normalized === 'Portugal') return 'PT';
    if (normalized === 'Greece') return 'GR';
    if (normalized === 'Israel') return 'IL';
    if (normalized === 'Japan') return 'JP';
    if (normalized === 'International 1') return 'Intl 1';
    if (normalized === 'International 2') return 'Intl 2';
    return normalized;
};
