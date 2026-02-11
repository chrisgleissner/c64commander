import { resolveAudioMixerMuteValue } from '@/lib/config/audioMixerSolo';
import { parseSidBaseAddress } from '@/lib/config/sidDetails';
import { EMPTY_SELECT_LABEL, EMPTY_SELECT_VALUE, SID_SLIDER_DETENT_RANGE } from '../constants';

export const normalizeSelectValue = (value: string) => (value.trim().length === 0 ? EMPTY_SELECT_VALUE : value);

export const resolveSelectValue = (value: string) => (value === EMPTY_SELECT_VALUE ? '' : value);

export const formatSelectOptionLabel = (value: string) => (value === EMPTY_SELECT_VALUE ? EMPTY_SELECT_LABEL : value);

export const normalizeSelectOptions = (options: string[], currentValue: string) => {
    const cleaned = options
        .map((option) => String(option))
        .filter((option) => option.trim().length > 0);
    const unique = Array.from(new Set(cleaned));
    if (currentValue.trim().length > 0 && !unique.includes(currentValue)) {
        unique.push(currentValue);
    }
    const includesEmpty = options.some((option) => String(option).trim().length === 0)
        || currentValue.trim().length === 0;
    return includesEmpty ? [...unique, EMPTY_SELECT_VALUE] : unique;
};

export const normalizeOptionToken = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

type ToggleOptionHints = {
    enabled?: string[];
    disabled?: string[];
};

const DEFAULT_ENABLED_TOKENS = ['enabled', 'on', 'true', 'yes', '1', 'swap', 'swapped'];
const DEFAULT_DISABLED_TOKENS = ['disabled', 'off', 'false', 'no', '0', 'normal', 'default', 'unswapped'];

const hasNormalizedMatch = (option: string, candidates: string[]) => {
    const normalizedOption = normalizeOptionToken(option);
    return candidates.some((candidate) => normalizedOption === normalizeOptionToken(candidate));
};

export const resolveToggleOption = (options: string[], enabled: boolean, hints?: ToggleOptionHints) => {
    const preferred = enabled ? hints?.enabled ?? [] : hints?.disabled ?? [];
    const defaults = enabled ? DEFAULT_ENABLED_TOKENS : DEFAULT_DISABLED_TOKENS;
    const match = options.find((option) => hasNormalizedMatch(option, [...preferred, ...defaults]));
    if (match) return match;
    if (options.length) return enabled ? options[0] : options[options.length - 1];
    return enabled ? 'Enabled' : 'Disabled';
};

export const parseNumericOption = (value: string) => {
    const match = value.trim().match(/[+-]?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
};

export const resolveOptionIndex = (options: string[], currentValue: string) => {
    const normalizedValue = normalizeOptionToken(currentValue);
    let index = options.findIndex((option) => normalizeOptionToken(option) === normalizedValue);
    if (index >= 0) return index;
    const numericValue = parseNumericOption(currentValue);
    if (numericValue !== null) {
        index = options.findIndex((option) => parseNumericOption(option) === numericValue);
    }
    return index >= 0 ? index : 0;
};

export const resolveVolumeCenterIndex = (options: string[]) => {
    const numericIndex = options.findIndex((option) => parseNumericOption(option) === 0);
    if (numericIndex >= 0) return numericIndex;
    const normalizedIndex = options.findIndex((option) => normalizeOptionToken(option) === '0 db');
    return normalizedIndex >= 0 ? normalizedIndex : null;
};

export const resolvePanCenterIndex = (options: string[]) => {
    const centerIndex = options.findIndex((option) => normalizeOptionToken(option) === 'center');
    return centerIndex >= 0 ? centerIndex : null;
};

export const clampSliderValue = (value: number, max: number) => Math.min(Math.max(value, 0), max);

export const clampToRange = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const resolveSliderIndex = (value: number, max: number) => clampSliderValue(Math.round(value), max);

export const applySoftDetent = (value: number, centerIndex: number | null) => {
    if (centerIndex === null) return value;
    const distance = Math.abs(value - centerIndex);
    return distance <= SID_SLIDER_DETENT_RANGE ? centerIndex : value;
};

export const formatSidBaseAddress = (value: unknown) => {
    const parsed = parseSidBaseAddress(value);
    if (parsed === null) return '$----';
    return `$${parsed.toString(16).toUpperCase().padStart(4, '0')}`;
};

export const resolveSidSocketToggleValue = (options: string[], enable: boolean) => {
    const enabledTokens = ['enabled', 'on', 'true'];
    const disabledTokens = ['disabled', 'off', 'false'];
    const match = options.find((option) => {
        const normalized = normalizeOptionToken(option);
        return enable ? enabledTokens.includes(normalized) : disabledTokens.includes(normalized);
    });
    if (match) return match;
    if (options.length) return enable ? options[0] : options[options.length - 1];
    return enable ? 'Enabled' : 'Disabled';
};

export const resolveSidAddressEnableValue = (options: string[]) => {
    const enableOption = options.find((option) => parseSidBaseAddress(option) !== null);
    return enableOption ?? options[0] ?? 'Unmapped';
};

export const resolveSidAddressDisableValue = (options: string[]) => {
    const disableOption = options.find((option) => {
        const normalized = normalizeOptionToken(option);
        return normalized === 'unmapped' || normalized === 'disabled' || normalized === 'off';
    });
    return disableOption ?? 'Unmapped';
};

export const isSilentSidValue = (value: string, options: string[]) => {
    const muteValue = resolveAudioMixerMuteValue(options);
    return normalizeOptionToken(value) === normalizeOptionToken(muteValue);
};
